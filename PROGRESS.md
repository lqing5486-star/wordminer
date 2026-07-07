# WordMiner · 进度存档

> 最后更新：2026-07-07。项目目录：`C:\Users\user1\Desktop\vocab-server`（含空格路径，bash 里加引号）。

## 一句话现状
「看 YouTube 视频挖词学英语」网站，已上线 **https://wordminer.onrender.com**。
**抓字幕改用 Supadata 托管 API**（它替我们绕过 YouTube 对机房 IP 的封锁），Render 后端直接抓 → 纯公网网站，任何设备/浏览器可用，不需本机 helper、不需 cookie。查词/翻译走 Render。

## 架构
- **全部跑在 Render**：前端 `public/index.html` + `/api/subtitles` + `/api/lookup` + `/api/translate` + `/health`。
- **抓字幕 = Supadata API**：`GET https://api.supadata.ai/v1/transcript?url=<视频URL>&lang=en&mode=native`，头 `x-api-key: $SUPADATA_API_KEY`。
  - 返回 `{ lang, content:[{text,offset,duration}], availableLangs }`；长视频(>20min)返回 202+jobId，轮询 `/v1/transcript/{jobId}`。
  - `mode=native` = 只取已有字幕，1 credit/次（省额度）。免费额度 100 credits/月。
  - key 申请：https://dash.supadata.ai/organizations/api-key
- **回退**：没配 `SUPADATA_API_KEY` 时（本地住宅 IP）自动回退 youtubei.js。所以本地 `npm start` 不用 key 也能抓。

## ⚙️ Render 需要配的环境变量
- **`SUPADATA_API_KEY`** = 你的 Supadata key（必填，否则 Render 上抓不到字幕会一直回退 youtubei→LOGIN_REQUIRED 失败）。
- `YT_COOKIE`：**已废弃无用**，可删。
- `NODE_VERSION`：保留。

## 走过的弯路（别重来）
- ❌ cookie 方案：实测 Render 机房 IP 下 4 种会话模式全 `LOGIN_REQUIRED`，cookie 救不了。已放弃。
- ❌ 本机 helper 方案：可行但要开代理+本机常开+仅 Chrome/Firefox，体验差。已被 Supadata 取代。

## 关键信息（别丢）
- **本机代理端口 = 17890**。墙内做 git/gh 操作前：
  ```bash
  export HTTPS_PROXY=http://127.0.0.1:17890 HTTP_PROXY=http://127.0.0.1:17890
  ```
- **GitHub**：https://github.com/lqing5486-star/wordminer （gh 已登录 lqing5486-star）
- **Render**：wordminer，免费套餐，push main 自动部署（3-5 分钟），闲置休眠冷启动 ~30 秒。
- **线上**：https://wordminer.onrender.com

## 技术栈
- 纯 Node.js（无框架），`server.js`。
- 查词 `/api/lookup` = 谷歌免费翻译 + dictionaryapi.dev（音标/词性/释义），MyMemory 降级。
- 前端挖词：停用词过滤 + 词长/词频打分取 top 18，卡片并发查词。

## 下一步（就差这个）
1. 去 https://dash.supadata.ai 注册，拿 API key。
2. Render → wordminer → Environment → 加 `SUPADATA_API_KEY` = 那个 key → Save（自动重部署）。
3. 打开 https://wordminer.onrender.com 粘链接挖词，端到端验证。

## 本地跑
```bash
cd "C:\Users\user1\Desktop\vocab-server"
# 有 key：SUPADATA_API_KEY=xxx npm start（直连，不用代理）
# 无 key 回退 youtubei（墙内需代理）：
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:17890 HTTP_PROXY=http://127.0.0.1:17890 npm start
# http://localhost:3000
```

## 可选增强
- Supadata 免费额度不够时：升级套餐，或换 TranscriptAPI/Scrapingdog 等（同为托管字幕 API）。
- 现成替代品（连网站都不想维护时）：Language Reactor / Trancy 浏览器插件已实现同类功能。

