/**
 * WordMiner · 后端服务
 * - 同源托管前端 (public/index.html)
 * - GET /api/subtitles?video=ID   抓取 YouTube 字幕 (youtubei.js + 本地会话/PO token)
 * - GET /api/lookup?word=xxx      真实查词 (英文释义 + 中文翻译)
 * - GET /api/translate?q=句子      整句翻译成中文
 *
 * 代理：本地在墙内需连 YouTube 时，用
 *   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:17890 npm start
 * 部署到海外服务器(Render)直连，无需任何代理。
 */
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { Innertube } = require('youtubei.js');

const PORT = process.env.PORT || 3000;

// ---------- YouTube 客户端（单例，带本地会话以获得可下载的字幕地址）----------
let ytPromise = null;
function getYT() {
  if (!ytPromise) {
    // 清洗 cookie：从浏览器复制常带换行/缩进空格，会导致 "invalid header value"。
    // cookie 各项本身不含空白，安全地把所有空白折叠成单空格。
    const cookie = process.env.YT_COOKIE
      ? process.env.YT_COOKIE.replace(/\s+/g, ' ').trim()
      : '';
    // 必须同时开本地会话(generate_session_locally)：
    //  - cookie 负责登录，绕过云机房 IP 的 LOGIN_REQUIRED
    //  - 本地会话负责生成 POT token，否则 caption base_url 下载回来是空的
    const opts = cookie
      ? { cookie, generate_session_locally: true }
      : { generate_session_locally: true };
    ytPromise = Innertube.create(opts).catch((e) => {
      ytPromise = null; // 允许下次重试
      throw e;
    });
  }
  return ytPromise;
}

// ---------- 通用 fetch 取文本 ----------
async function getText(targetUrl, headers = {}) {
  const r = await fetch(targetUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers,
    },
  });
  return r.text();
}

// ---------- 抓取字幕 ----------
async function fetchSubtitles(videoId) {
  const yt = await getYT();
  const info = await yt.getInfo(videoId);

  const caps = info.captions && info.captions.caption_tracks;
  if (!caps || caps.length === 0) {
    const err = new Error('该视频没有可用字幕（或未开启字幕）。换一个带 CC 字幕的视频试试。');
    err.code = 'NO_CAPTIONS';
    throw err;
  }

  // 优先英文字幕
  const track =
    caps.find((c) => c.language_code === 'en') ||
    caps.find((c) => /^en/i.test(c.language_code || '')) ||
    caps[0];

  const jsonUrl =
    track.base_url + (track.base_url.includes('?') ? '&' : '?') + 'fmt=json3';
  const raw = await getText(jsonUrl);

  const segments = [];
  try {
    const data = JSON.parse(raw);
    (data.events || []).forEach((ev) => {
      if (!ev.segs) return;
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
      if (text) segments.push({ start: (ev.tStartMs || 0) / 1000, text });
    });
  } catch (e) {
    // 兜底：XML 版
    const xml = await getText(track.base_url);
    xml
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
      .forEach((t) => segments.push({ start: 0, text: t }));
  }

  if (segments.length === 0) {
    const err = new Error('字幕内容为空，可能被 YouTube 限制，请换一个视频。');
    err.code = 'EMPTY_CAPTIONS';
    throw err;
  }

  return {
    videoId,
    language: track.language_code || 'en',
    subtitles: segments.map((s) => s.text).join('\n'),
    segments,
  };
}

// ---------- 查词：中文翻译 (谷歌免费接口，MyMemory 降级) ----------
const lookupCache = new Map();

async function translateViaGoogle(text, tl) {
  const api = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(
    text
  )}`;
  const raw = await getText(api);
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || !Array.isArray(data[0])) return '';
  return data[0].map((seg) => (seg && seg[0]) || '').join('').trim();
}

async function translateViaMyMemory(text, langpair) {
  const api = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    text
  )}&langpair=${langpair}`;
  const raw = await getText(api);
  const data = JSON.parse(raw);
  const t = (data.responseData && data.responseData.translatedText) || '';
  if (/MYMEMORY WARNING|QUOTA|USED ALL AVAILABLE/i.test(t)) return '';
  return t;
}

async function translateText(text, tl = 'zh-CN') {
  const key = tl + '::' + text.toLowerCase();
  if (lookupCache.has(key)) return lookupCache.get(key);
  let translated = '';
  try {
    translated = await translateViaGoogle(text, tl);
  } catch (e) {}
  if (!translated) {
    try {
      translated = await translateViaMyMemory(text, `en|${tl}`);
    } catch (e) {}
  }
  if (translated) lookupCache.set(key, translated);
  return translated;
}

// ---------- 查词：英文词典 (音标/词性/释义) ----------
async function dictLookup(word) {
  try {
    const api = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(
      word.toLowerCase()
    )}`;
    const raw = await getText(api);
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
});
