# XLive REST API

完整、可交互的 OpenAPI UI 运行于 `/api/docs`。所有 JSON API 使用 `/api` 前缀；认证信息放在 HttpOnly Cookie 中。

## 认证与用户

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 按后台注册模式创建账号 |
| POST | `/api/auth/login` | 登录并设置 Access/Refresh Cookie |
| POST | `/api/auth/refresh` | 轮换短期 Access Token |
| POST | `/api/auth/logout` | 撤销 Refresh Token |
| GET | `/api/auth/captcha` | 生成图形验证码图片（发码前需通过校验） |
| POST | `/api/auth/email/send-code` | 真实发送邮箱验证码（需 captchaId + captchaText） |
| POST | `/api/auth/sms/send-code` | 真实发送阿里云短信验证码（需 captchaId + captchaText） |
| POST | `/api/auth/reset-password` | 验证码重置密码并撤销会话 |
| POST | `/api/auth/change-password` | 当前用户修改密码 |
| GET/PATCH | `/api/users/me` | 当前用户资料 |
| POST | `/api/uploads/images` | 登录用户上传图片（JPG/PNG/WebP，≤5MB），用于头像/封面 |

## 直播间

| Method | Path | 说明 |
|---|---|---|
| GET/POST | `/api/rooms` | 公开列表 / 创建房间 |
| GET/PATCH | `/api/rooms/{roomNumber}` | 房间详情 / 主播修改 |
| GET | `/api/users/me/rooms` | 主播房间和近期 Session |
| GET | `/api/rooms/{roomNumber}/stream` | 仅房主读取推流参数 |
| POST | `/api/rooms/{roomNumber}/stream/rotate` | 立即轮换密钥并断开旧流 |
| POST | `/api/rooms/{roomNumber}/viewers/heartbeat` | 45 秒 TTL 观看心跳 |
| GET | `/api/categories` | 启用的公开分类 |

## 媒体服务器

`POST /api/media/hooks?secret=...` 仅供内部 SRS 调用，公网 Nginx 明确返回 404。支持 `on_publish`、`on_unpublish` 和 `on_dvr`。`on_publish` 校验流名、Token Hash、用户状态和直播权限；非 2xx 响应使 SRS 拒绝推流。`on_dvr` 将录制文件关联到直播场次；若该房间关闭了「生成直播回放」（`record_replay`），录制文件会被立即删除且不产生回放。

`GET /api/rooms/:roomNumber/replays` 返回房间的可用回放；`GET /api/replays/:sessionId/danmaku` 返回按直播时间偏移排序的回放弹幕。

## 管理后台

`/api/admin/**` 需要 ADMIN 或 SUPER_ADMIN；设置、管理员创建和外部服务测试仅 SUPER_ADMIN。

- `GET /api/admin/dashboard|users|rooms|categories|logs`
- `PATCH /api/admin/users/{id}`
- `POST /api/admin/users/{id}/reset-password`
- `POST /api/admin/rooms/{roomNumber}/stop|ban|unban`
- `POST/PATCH/DELETE /api/admin/categories`
- `GET /api/admin/files`、`DELETE /api/admin/files/{id}`、`GET /api/admin/files/{id}/download`（上传文件管理）
- `GET /api/admin/replays`、`DELETE /api/admin/replays/{id}`、`GET /api/admin/replays/{id}/download`（回放管理）
- `GET/PUT /api/admin/settings`
- `POST /api/admin/settings/smtp/test|sms/test`
- `POST /api/admin/admins`

## 状态码

- `400` 业务参数不满足规则
- `401` 未登录、Token/Hook 签名无效
- `403` RBAC、账号或直播权限拒绝
- `404` 资源不存在
- `409` 唯一约束或资源状态冲突
- `422` Zod 参数校验失败
- `423` 登录失败次数过多导致临时锁定
- `429` 发送频率或接口速率限制
- `502` SMTP/SMS 上游真实调用失败
