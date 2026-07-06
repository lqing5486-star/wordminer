/**
 * WordMiner · 后端服务
 * - 同源托管前端 (public/index.html)
 * - GET /api/subtitles?video=ID   抓取 YouTube 字幕
 * - GET /api/lookup?word=xxx      真实查词 (英文释义 + 中文翻译)
 * - GET /api/translate?q=句子      整句翻译成中文
 *
 * 代理：本地开发在墙内需走代理，设环境变量 PROXY_URL=http://127.0.0.1:7890 即可；
 *       部署到海外服务器(Render)时不设，直连 YouTube。
 */
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PROXY_URL = process.env.PROXY_URL || ''; // 例：http://127.0.0.1:7890

let proxyAgent = null;
if (PROXY_URL) {
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    proxyAgent = new HttpsProxyAgent(PROXY_URL);
    console.log(`🌐 已启用代理: ${PROXY_URL}`);
  } catch (e) {
    console.warn('⚠️ 设置了 PROXY_URL 但未安装 https-proxy-agent，将直连。');
  }
}

// ---------- 通用 HTTPS GET，返回文本 ----------
function httpsGet(targetUrl, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      agent: proxyAgent || undefined,
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        // 绕过 YouTube 欧盟同意页
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+000',
        ...extraHeaders,
      },
    };
    const req = https.get(targetUrl, opts, (res) => {
      // 跟随重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpsGet(res.headers.location, extraHeaders));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
  });
}

// ---------- 从一段文本里用括号配对法安全提取 JSON 对象 ----------
function extractJsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  let i = html.indexOf('{', start);
  if (i === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const jsonStr = html.slice(i, j + 1);
          try {
            return JSON.parse(jsonStr);
          } catch (e) {
            return null;
          }
        }
      }
    }
  }
  return null;
}

// ---------- 抓取字幕 ----------
async function fetchSubtitles(videoId) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const html = await httpsGet(pageUrl);

  let captionTracks = null;

  // 策略1：括号配对法解析 ytInitialPlayerResponse
  const player = extractJsonAfter(html, 'ytInitialPlayerResponse');
  if (player) {
    try {
      captionTracks =
        player.captions.playerCaptionsTracklistRenderer.captionTracks;
    } catch (e) {
      /* 继续兜底 */
    }
  }

  // 策略2：正则兜底
  if (!captionTracks) {
    const m = html.match(/"captionTracks":\s*(\[.*?\])/s);
    if (m) {
      try {
        captionTracks = JSON.parse(m[1]);
      } catch (e) {}
    }
  }

  if (!captionTracks || captionTracks.length === 0) {
    const err = new Error(
      '未找到该视频的字幕。可能原因：视频无字幕 / 服务器 IP 被 YouTube 限制。'
    );
    err.code = 'NO_CAPTIONS';
    throw err;
  }

  // 优先英文
  const track =
    captionTracks.find((t) => t.vssId && t.vssId.includes('.en')) ||
    captionTracks.find((t) => t.languageCode === 'en') ||
    captionTracks[0];

  // 拿 json3 格式，解析更稳
  const baseUrl = track.baseUrl;
  const jsonUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';

  let segments = [];
  let plainText = '';
  try {
    const raw = await httpsGet(jsonUrl);
    const data = JSON.parse(raw);
    (data.events || []).forEach((ev) => {
      if (!ev.segs) return;
      const text = ev.segs.map((s) => s.utf8).join('').replace(/\n/g, ' ').trim();
      if (text) {
        segments.push({ start: (ev.tStartMs || 0) / 1000, text });
      }
    });
    plainText = segments.map((s) => s.text).join('\n');
  } catch (e) {
    // 兜底：XML 版
    const xml = await httpsGet(baseUrl);
    plainText = xml
      .replace(/<text[^>]*>/g, '\n')
      .replace(/<\/text>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#160;/g, ' ')
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
    segments = plainText.split('\n').map((t) => ({ start: 0, text: t }));
  }

  return {
    videoId,
    language: track.languageCode || 'en',
    subtitles: plainText,
    segments,
  };
}

// ---------- 查词：中文翻译 (MyMemory) ----------
const lookupCache = new Map();
async function translateText(text, langpair = 'en|zh-CN') {
  const key = langpair + '::' + text.toLowerCase();
  if (lookupCache.has(key)) return lookupCache.get(key);
  const api = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    text
  )}&langpair=${langpair}`;
  const raw = await httpsGet(api, { Cookie: '' });
  const data = JSON.parse(raw);
  const translated =
    (data.responseData && data.responseData.translatedText) || '';
  lookupCache.set(key, translated);
  return translated;
}

// ---------- 查词：英文词典 (音标/词性/释义) ----------
async function dictLookup(word) {
  try {
    const api = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(
      word.toLowerCase()
    )}`;
    const raw = await httpsGet(api, { Cookie: '' });
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr[0]) return null;
    const entry = arr[0];
    let phonetic = entry.phonetic || '';
    if (!phonetic && Array.isArray(entry.phonetics)) {
      const ph = entry.phonetics.find((x) => x.text);
      if (ph) phonetic = ph.text;
    }
    const meanings = (entry.meanings || []).slice(0, 3).map((m) => ({
      pos: m.partOfSpeech,
      def: (m.definitions && m.definitions[0] && m.definitions[0].definition) || '',
    }));
    return { phonetic, meanings };
  } catch (e) {
    return null;
  }
}

// ---------- 静态文件 ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
function serveStatic(req, res) {
  let pathname = url.parse(req.url).pathname;
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(PUBLIC_DIR, pathname);
  // 防目录穿越
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;

  try {
    if (p === '/api/subtitles') {
      const videoId = parsed.query.video;
      if (!videoId) return sendJson(res, 400, { error: '缺少 video 参数' });
      console.log(`📥 抓字幕: ${videoId}`);
      const result = await fetchSubtitles(videoId);
      console.log(`✅ 字幕抓取成功: ${result.segments.length} 行`);
      return sendJson(res, 200, { success: true, ...result });
    }

    if (p === '/api/lookup') {
      const word = (parsed.query.word || '').trim();
      if (!word) return sendJson(res, 400, { error: '缺少 word 参数' });
      const [zh, dict] = await Promise.all([
        translateText(word).catch(() => ''),
        dictLookup(word).catch(() => null),
      ]);
      return sendJson(res, 200, {
        success: true,
        word,
        zh,
        phonetic: dict ? dict.phonetic : '',
        meanings: dict ? dict.meanings : [],
      });
    }

    if (p === '/api/translate') {
      const q = (parsed.query.q || '').trim();
      if (!q) return sendJson(res, 400, { error: '缺少 q 参数' });
      const zh = await translateText(q);
      return sendJson(res, 200, { success: true, q, zh });
    }

    if (p === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    // 其余走静态资源
    return serveStatic(req, res);
  } catch (error) {
    console.error(`❌ ${p} 出错: ${error.message}`);
    return sendJson(res, 500, { error: error.message, code: error.code || 'ERR' });
  }
});

process.on('uncaughtException', (err) => {
  console.error('💥 未捕获异常:', err.message);
});

server.listen(PORT, () => {
  console.log(`🚀 WordMiner 后端启动: http://localhost:${PORT}`);
  console.log(`   静态首页: /   接口: /api/subtitles /api/lookup /api/translate`);
});
