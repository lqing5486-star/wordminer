# WordMiner · 进度存档

> 最后更新：2026-07-06。给明天接着做用。项目目录：`C:\Users\user1\Desktop\vocab-server`（含空格路径，bash 里加引号）。

## 一句话现状
「看 YouTube 视频挖词学英语」网站，已重写成可部署版并**部署到 Render 上线**，固定网址
**https://wordminer.onrender.com** 已能打开。查词/翻译已线上验证通过；**只差最后一步：填 YouTube Cookie 解决抓字幕的云服务器 IP 封锁**。

## 关键信息（别丢）
- **本机代理端口 = 17890**（不是默认 7890）。墙内做任何 git/gh/YouTube 操作前先：
  ```bash
  export HTTPS_PROXY=http://127.0.0.1:17890 HTTP_PROXY=http://127.0.0.1:17890
  git config --global http.proxy http://127.0.0.1:17890   # 已配好
  ```
- **GitHub 仓库**：https://github.com/lqing5486-star/wordminer （账号 lqing5486-star，gh 已登录）
- **Render 服务**：wordminer，免费套餐，连着上面 GitHub 仓库，**push 到 main 会自动部署**（约 3-5 分钟）。免费版闲置会休眠，首访冷启动 ~30 秒。
- **线上网址**：https://wordminer.onrender.com

## 技术栈 / 架构
- 纯 Node.js（无框架），`server.js` 同源托管 `public/index.html` + 3 个 API。
- **抓字幕**：`youtubei.js`。关键配方 = `Innertube.create({ generate_session_locally: true })` → `getInfo(videoId)` → 取 `info.captions.caption_tracks` → 下载 `track.base_url + '&fmt=json3'` 解析 events。
  - 裸抓 YouTube 网页/timedtext 会返回**空**（2024 后的 POT token 校验），所以必须用 youtubei.js 的本地会话。
- **查词**：`/api/lookup` = 谷歌免费翻译接口(`translate.googleapis.com/translate_a/single`) 出中文 + dictionaryapi.dev 出音标/词性/英文释义。MyMemory 作降级（机房 IP 额度会秒光，别当主力）。
- **前端挖词**：停用词表过滤 + 词长/词频打分，取 top 18，卡片并发查词。

## ✅ 已完成并验证
1. server.js 重写：同源托管 + `/api/subtitles` + `/api/lookup` + `/api/translate` + `/health`，`listen(process.env.PORT)`。
2. 前端 `public/index.html` 重写：改名 **WordMiner**、API 相对路径、真实释义卡片、加载态、移动端响应式。
3. 部署配置：package.json(start脚本/engines)、.gitignore、render.yaml、README。
4. 推 GitHub + Render 上线，拿到固定网址。
5. **本地全链路通过**（走代理模拟）：抓字幕 150KB 正常、查词 `development→发育`、整句翻译正常。
6. 线上查词/翻译验证通过。

## ⛔ 当前唯一卡点：YouTube 封云 IP
- Render 机房 IP 下，youtubei.js 所有客户端(WEB/ANDROID/IOS/MWEB/TV/...)都返回 `playability: LOGIN_REQUIRED`，拿不到字幕。这是 YouTube 对所有云服务器 IP 的反爬（家用 IP 不受影响）。
- 诊断接口：`GET https://wordminer.onrender.com/api/debug?video=VIDEO_ID` 会列出各客户端结果（**验证通过后记得从 server.js 删掉这个 /api/debug 分支**）。
- **已选方案：YouTube Cookie**。代码已支持：`getYT()` 读环境变量 `YT_COOKIE`，有就用 `Innertube.create({ cookie })`，否则本地会话。

## 👉 明天的下一步（就差这个）
1. **用户拿 Cookie**：用 YouTube **小号**登录 → F12 → Network → 刷新 → 点最上面 `www.youtube.com` 那条 → Request Headers → 复制 `cookie:` 后整串。
2. **填到 Render**：dashboard → wordminer → Environment → Add `YT_COOKIE` = 那串 cookie → Save（自动重部署）。
3. **验证**：
   ```bash
   export HTTPS_PROXY=http://127.0.0.1:17890 HTTP_PROXY=http://127.0.0.1:17890
   curl -s -m 90 "https://wordminer.onrender.com/api/subtitles?video=hmtuvNfytjM" | head -c 200
   curl -s -m 60 "https://wordminer.onrender.com/api/debug?video=hmtuvNfytjM"   # 看 play 是否变 OK、caps>0、dlLen>0
   ```
   若 caps>0 且 dlLen>0 → 成功。然后删掉 /api/debug、打开网页端到端点一遍收尾。
4. 若 Cookie 仍 LOGIN_REQUIRED（小概率）：退路 = 住宅代理（付费）或改「用户粘贴字幕」模式（见当时对话选项）。

## 本地跑起来（墙内需带这些环境变量）
```bash
cd "C:\Users\user1\Desktop\vocab-server"
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:17890 HTTP_PROXY=http://127.0.0.1:17890 npm start
# 打开 http://localhost:3000
```
