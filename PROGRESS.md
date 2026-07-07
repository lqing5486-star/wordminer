# WordMiner · 进度存档

> 最后更新：2026-07-07。项目目录：`C:\Users\user1\Desktop\vocab-server`（含空格路径，bash 里加引号）。

## 一句话现状
「看 YouTube 视频挖词学英语」网站，已上线 **https://wordminer.onrender.com**。
查词/翻译走 Render（正常）。**抓字幕改为"本机 helper"架构**——因为 YouTube 彻底封锁云机房 IP，cookie 也救不了（已实测排除）。用户在本机双击 `start-helper.bat` 启动字幕服务，网页自动调用本机抓字幕。

## 架构（重要）
- **Render（云端）**：托管前端 `public/index.html` + `/api/lookup`（查词）+ `/api/translate`（整句翻译）+ `/health`。这些机房 IP 都能用。
- **本机 helper**：同一份 `server.js`，用户本机跑（住宅 IP），提供 `/api/subtitles`。Render 页面用 `fetch` 跨域调用 `http://127.0.0.1:3000/api/subtitles`（server 已开 `Access-Control-Allow-Origin:*`）。
  - 浏览器限制：HTTPS 页面只有对 `localhost/127.0.0.1` 才允许调本机 HTTP。**Chrome/Firefox 可用，Safari 不行。**
  - 前端 `helperBase()`：读 `localStorage.helperBase`，默认 `http://127.0.0.1:3000`；页面本身在 localhost 时用同源。
  - 页面加载与抓词时会检测 helper 是否在线（调 `/health`），未启动则弹出引导。

## 为什么放弃 cookie（别再走回头路）
- Render 机房 IP 下，`getInfo` 一律 `playability: LOGIN_REQUIRED`。
- 实测 4 种会话模式（仅cookie / cookie+本地会话 / 仅本地会话 / 裸连）**全部 LOGIN_REQUIRED**（`cookieLen:2312` 确认 cookie 读到了）。
- 结论：YouTube 直接拒绝数据中心 IP，且会因跨地域异常使 cookie 失效。cookie 这条路死了。
- 本机住宅 IP 不受影响：不带 cookie、`generate_session_locally: true` 就能抓（实测 679 行 / 133KB）。
- Render 上的 `YT_COOKIE` 环境变量现在**无用**，可留可删（代码里 cookie 仍会被清洗后传入，无害）。

## 关键信息（别丢）
- **本机代理端口 = 17890**（不是默认 7890）。墙内做 git/gh/YouTube 操作前先：
  ```bash
  export HTTPS_PROXY=http://127.0.0.1:17890 HTTP_PROXY=http://127.0.0.1:17890
  git config --global http.proxy http://127.0.0.1:17890   # 已配好
  ```
- **GitHub 仓库**：https://github.com/lqing5486-star/wordminer （账号 lqing5486-star，gh 已登录）
- **Render 服务**：wordminer，免费套餐，连 GitHub 仓库，**push 到 main 自动部署**（约 3-5 分钟）。免费版闲置休眠，首访冷启动 ~30 秒。
- **线上网址**：https://wordminer.onrender.com

## 技术栈
- 纯 Node.js（无框架），`server.js` 同源托管 `public/index.html` + API。
- **抓字幕**：`youtubei.js`。配方 = `Innertube.create({ generate_session_locally: true })`（生成本地会话拿 POT token）→ `getInfo(videoId)` → `info.captions.caption_tracks` → 下载 `track.base_url + '&fmt=json3'` 解析 events。
- **查词**：`/api/lookup` = 谷歌免费翻译(`translate.googleapis.com/translate_a/single`)出中文 + dictionaryapi.dev 出音标/词性/英文释义。MyMemory 降级。
- **前端挖词**：停用词过滤 + 词长/词频打分取 top 18，卡片并发查词。

## 用户日常使用步骤
1. 打开代理（端口 17890）。
2. 双击项目目录里的 `start-helper.bat`，出现"字幕服务启动中"黑窗口，保持开着。
3. 用 **Chrome/Firefox** 打开 https://wordminer.onrender.com （页面右上会显示"🟢 字幕服务在线"）。
4. 粘贴 YouTube 链接 → 开始智能挖词。用完关掉黑窗口即可。

## 本地整体跑（不经 Render，全部本地）
```bash
cd "C:\Users\user1\Desktop\vocab-server"
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:17890 HTTP_PROXY=http://127.0.0.1:17890 npm start
# 打开 http://localhost:3000 —— 抓字幕/查词/翻译全通
```

## 可选的后续增强（想到再做）
- 住宅代理（付费）：给 Render 配 `HTTPS_PROXY` 指向住宅代理，就能云端直接抓字幕、彻底摆脱本机 helper。
- "手动粘贴字幕"兜底模式：给不方便跑 helper / 用 Safari 的场景。
- helper 用 cloudflared/ngrok 隧道暴露 → 手机等其它设备也能用（URL 会变，需配置）。
