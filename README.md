# XLive

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-22%2B-green.svg)](package.json)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](docker-compose.yml)

一个可部署的多用户网页直播平台。主播使用 OBS / FFmpeg 通过鉴权 RTMP 推送到 SRS，SRS 输出低延迟 HLS，浏览器通过 hls.js 播放；业务状态由 SRS HTTP Hooks 自动驱动，不依赖主播手动点击「开始直播」。

**XLive** is a self-hostable multi-user live-streaming platform. Streamers push RTMP (authenticated by stream key) to SRS via OBS/FFmpeg; SRS produces low-latency HLS played back in the browser with hls.js. Room state is fully driven by SRS HTTP Hooks — no manual "go live" needed.

## ✨ 功能特性

- 邮箱/手机号注册模式、Argon2id 密码、HttpOnly Cookie Access/Refresh Token、登录失败锁定
- 邮箱与短信一次性验证码：5 分钟 TTL、60 秒冷却、IP 限流、Hash 存储、失败次数限制
- 用户资料、直播间、公开/私有房间、唯一房间号、分类、搜索、直播记录与可播放回放
- OBS Stream Key 显示/复制/立即轮换；数据库中 Hash 鉴权 + AES-256-GCM 加密备份
- SRS RTMP 鉴权、HLS 输出、开播/停播/录制 Webhook、自动强制断流、禁播
- 实时聊天与画面弹幕，回放时按原直播时间轴同步重放弹幕
- Redis ZSET 心跳在线人数，刷新/断网后自动过期；LiveSession 峰值与采样统计
- HLS.js 播放、原生 HLS 回退、自动播放降级、断线重连、离线状态
- USER / ADMIN / SUPER_ADMIN 后端 RBAC
- 管理后台：指标、系统资源、用户、房间、分类、日志、站点/注册/SMTP/SMS 等配置
- SMTP 连接验证和真实测试邮件；阿里云 Dysmsapi 真实签名请求与测试短信
- 站点名称、Logo、暗色 Logo、Favicon、SEO、备案、页脚动态配置；浅色/深色/跟随系统
- requestId、统一错误结构、日志敏感字段脱敏、参数校验、限流
- PostgreSQL 迁移、首次超级管理员初始化、Docker Compose、Nginx、Swagger

## 🏗 技术架构

```text
OBS / FFmpeg --RTMP--> SRS --HTTP Hooks--> Fastify API
                         |
                         +--HLS--> Nginx --> hls.js --> Browser

Vue 3 + TypeScript + Pinia + Naive UI
Fastify 5 + Prisma + PostgreSQL 16 + Redis 7
SRS 6 + Nginx + Docker Compose
```

推流名称与密钥分离。OBS 中显示的 Stream Key 形式为 `room_10001?token=<secret>`；SRS 实际流名是 `room_10001`，因此公开的 HLS URL 不包含密钥。

## 📁 目录结构

```text
apps/api                    后端、Prisma 模型/迁移、测试、Swagger
apps/web                    Vue SPA 与管理后台
infra/srs                   SRS 配置
infra/nginx                 入口代理、HLS MIME/缓存、上传文件
scripts                     RTMP 全链路测试脚本
docs/                       API 文档
docker-compose.yml          生产/完整部署编排
docker-compose.dev.yml      本地开发热更新覆盖层
```

## 🚀 快速开始

### 环境要求

- Docker Desktop 4.x 或 Docker Engine 25+（含 Docker Compose v2）
- 本地开发可选 Node.js 22+
- OBS Studio，或用项目脚本自动拉取 FFmpeg 容器

### 启动

1. 克隆仓库并复制环境变量模板：

   ```bash
   git clone https://github.com/itxiaohui66/xlive.git
   cd xlive
   cp .env.example .env
   ```

2. 修改 `.env`，至少替换以下值（生产环境请使用密码管理器生成随机值）：

   - `JWT_SECRET`、`CONFIG_ENCRYPTION_KEY`、`SRS_HOOK_SECRET`
   - `ADMIN_PASSWORD`
   - `POSTGRES_PASSWORD`（如不使用模板中的开发默认值）

3. 构建并启动：

   ```bash
   docker compose up -d --build
   docker compose ps
   ```

数据库迁移与首次管理员创建由 API 容器自动完成。初始化只在用户名/邮箱不存在时创建管理员，不会在重启时覆盖密码。

- 网站：<http://localhost>
- Swagger：<http://localhost/api/docs>
- 健康检查：<http://localhost/health>
- RTMP：`rtmp://localhost/live`

默认开发管理员取自 `.env` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。首次登录后请立即更换密码。

## 🛠 本地开发

基础设施使用 Docker，前后端热更新：

```bash
docker compose up -d postgres redis srs
npm install
$env:DATABASE_URL="postgresql://xlive:xlive_dev_password@localhost:5432/xlive?schema=public"
$env:REDIS_URL="redis://localhost:6379"
npm run dev
```

也可使用 `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`。提交数据库变更前运行 `npx prisma migrate dev --schema apps/api/prisma/schema.prisma --name <name>`。

## 🎥 OBS 与真实直播测试

1. 注册并登录，进入「我的直播间」，创建直播间。
2. 在推流设置复制 RTMP Server 和完整 Stream Key。
3. OBS → 设置 → 直播 → 自定义：Server 填 `rtmp://localhost/live`，Stream Key 填页面值。
4. 视频编码使用 H.264、音频 AAC，建议关键帧间隔 2 秒。
5. 开始推流后，SRS 鉴权成功并回调 API，房间自动变为 LIVE，公开房间出现在首页。
6. 停止推流后，房间自动 OFFLINE，SRS 将本场直播录制为 FLV 回放，并生成带时间轴弹幕的直播记录。

无本机 FFmpeg 时，在 PowerShell 执行：

```powershell
.\scripts\rtmp-smoke.ps1 -StreamKey 'room_10001?token=从页面复制的密钥' -Seconds 60
```

打开 `http://localhost/room/10001` 验证画面。另一个终端可观察：

```bash
docker compose logs -f srs api
```

## ⚙️ 配置说明

所有运行配置通过 `.env` 注入（模板见 `.env.example`），关键项：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` / `REDIS_URL` | PostgreSQL / Redis 连接串 |
| `JWT_SECRET` / `CONFIG_ENCRYPTION_KEY` | Token 签名与敏感配置加密密钥 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` | 首次启动创建的超管账号 |
| `SRS_API_URL` / `SRS_HOOK_SECRET` | SRS HTTP API 地址与 Webhook 鉴权 |
| `RTMP_PUBLIC_URL` / `HLS_PUBLIC_URL` | 对外推流/播放地址 |
| `UPLOAD_DIR` / `LIVE_DIR` | 上传文件与直播切片目录 |

> ⚠️ **永远不要把真实的 `.env` 提交到仓库**。它已被 `.gitignore` 排除；`.env.example` 只含占位符模板。

SMTP 与阿里云短信配置在管理后台「系统设置」中完成：SMTP 填写 Host、Port、用户名、密码、加密方式（NONE/SSL/STARTTLS）；短信填写 AccessKey、签名与模板编号，密码/Secret 使用 AES-256-GCM 加密保存，接口仅返回 `********`。建议使用仅授予 `dysms:SendSms` 的 RAM 子账号。

## 🌐 生产部署与 HTTPS

1. 使用独立 PostgreSQL/Redis 凭据，Redis 不暴露公网。
2. 将域名写入 Nginx `server_name`，把 `.env` 的 `PUBLIC_URL`、`RTMP_PUBLIC_URL`、`HLS_PUBLIC_URL` 改为真实域名。
3. 用 Certbot/Let's Encrypt 申请证书，将证书只读挂载到 `/etc/nginx/certs`，启用 443 server 并将 80 重定向至 HTTPS。
4. 页面、API、HLS 必须统一 HTTPS；聊天室使用 WSS。RTMP 可继续使用 `rtmp://`（或在专用入口配置 RTMPS），不会产生浏览器 Mixed Content。
5. 设置 `COOKIE_SECURE=true`，限制防火墙只开放 80/443/1935。SRS API 1985 不应暴露公网。
6. 反向代理已为 HLS 配置正确 MIME、无缓存、CORS；上传限制为 10 MB。

## 💾 数据库、备份与升级

备份：

```bash
docker compose exec -T postgres pg_dump -U xlive -Fc xlive > xlive.dump
```

恢复到空库前先停止 API，并验证备份。升级时先备份，再拉取代码并运行 `docker compose up -d --build`；API 启动会执行尚未应用的 Prisma migration。不要删除已经在生产使用的 migration。

## 🧪 测试

```bash
npm run build
npm test
docker compose config --quiet
```

测试覆盖密码策略/Argon2id、敏感配置加密，以及 SRS 无效密钥与停播 Webhook。完整直播验证使用上述 `rtmp-smoke.ps1`，它生成动态测试源并真实经过 RTMP → SRS → HLS → 浏览器，不使用静态视频冒充。

## 📚 API 与错误格式

运行后 Swagger/OpenAPI 位于 `/api/docs`。主要端点见 [API 文档](docs/API.md)。错误统一返回：

```json
{"code":"ROOM_NOT_FOUND","message":"直播间不存在","requestId":"2cb…"}
```

数据库异常、堆栈、内部地址和密钥不会直接返回。

## ❓ 常见问题

- **Docker CLI 存在但无法连接**：先启动 Docker Desktop；Windows 可检查 `dockerDesktopLinuxEngine`。Docker Desktop 自身崩溃时查看 `%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log`。
- **推流被拒绝**：确认复制了完整 Stream Key、用户/房间未禁播，查看 `docker compose logs api srs`。
- **有推流但播放器 404**：等待首个 HLS 分片（通常 2–4 秒），确认编码是 H.264 + AAC，并检查挂载的 `srs_hls` volume。
- **自动播放失败**：浏览器要求首次自动播放静音；页面会提示用户点击播放。
- **SMTP/SMS 未配置**：系统检测应显示「未配置」，不是「正常」；测试接口不会伪造成功。

## 🔒 安全

- 真实 `.env`、数据库备份、上传内容与证书均被 `.gitignore` 排除，请勿强行提交。
- 发现安全漏洞请通过私密渠道联系维护者，不要在公开 Issue 中披露细节。
- 部署后请立即修改默认管理员密码，并定期备份数据库。

## 👤 作者

- 作者：**itxiaohui**
- 网站：<http://www.itxiaohui.top>
- 作者社区：<http://www.itky.cc>

有问题或建议欢迎到社区交流，或在本仓库提交 Issue / Pull Request。

## 📄 许可证

[MIT](LICENSE) © 2026 itxiaohui
