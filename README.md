# WordMiner ⛏️ · 看视频挖词学英语

粘贴 YouTube 链接 → 一键抓取英文字幕 → 智能挖出高价值生词 → 真实中英释义，边看边学。

## 功能
- **抓字幕**：输入任意带英文字幕的 YouTube 视频，自动抓取并清洗字幕原文。
- **智能挖词**：停用词过滤 + 词频/词长打分，挑出真正值得学的生词（而非 the/is 这类）。
- **真实查词**：每个生词给出音标、词性、英文释义（dictionaryapi.dev）+ 中文翻译（MyMemory），非写死词典。
- **边看边学**：右侧内嵌 YouTube 播放器，左边字幕、右边卡片。

## 技术栈
纯 Node.js（无框架，零构建）+ 原生 HTML/CSS/JS。后端同源托管前端，无 CORS 烦恼。

## 本地运行
```bash
npm install
# 墙内需走代理直连 YouTube（Clash 默认 7890）：
PROXY_URL=http://127.0.0.1:7890 npm start
# 海外/服务器直连：
npm start
```
打开 http://localhost:3000

## 接口
| 接口 | 说明 |
|---|---|
| `GET /api/subtitles?video=VIDEO_ID` | 抓取字幕，返回 `{subtitles, segments}` |
| `GET /api/lookup?word=xxx` | 查词：`{zh, phonetic, meanings}` |
| `GET /api/translate?q=句子` | 整句翻译成中文 |
| `GET /health` | 健康检查 |

## 部署（Render 免费版）
1. 把本仓库推到 GitHub。
2. Render → New → Blueprint，选中仓库（会读取 `render.yaml`）。或 New → Web Service，Build `npm install`、Start `node server.js`。
3. 部署完成得到固定网址 `https://wordminer-xxxx.onrender.com`。
   > 部署在海外机房，直连 YouTube，**无需代理**。免费版闲置会休眠，首次访问约 20~30 秒冷启动。

## 环境变量
| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口（Render 自动注入） |
| `PROXY_URL` | 可选，本地墙内代理，如 `http://127.0.0.1:7890` |
