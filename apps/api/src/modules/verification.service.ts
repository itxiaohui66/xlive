import type { PrismaClient, CodeChannel, CodePurpose } from '@prisma/client';
import type { RedisLike } from '../lib/redis.js';
import { randomCode, randomToken, sha256, safeEqual } from '../lib/crypto.js';
import { AppError, assert } from '../lib/errors.js';
import type { MessagingService } from './messaging.service.js';

// 图形验证码：本地生成 SVG 图片（英文字母），答案哈希后存入 Redis，一次性使用
const CAPTCHA_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const captchaKey = (id: string, text: string) => `captcha:${sha256(`${id}:${text}`)}`;
function renderCaptchaSvg(text: string) {
  const colors = ['#c0392b', '#1f618d', '#1e8449', '#6c3483', '#b9770e', '#21618c'];
  const chars = text.split('').map((ch, i) => {
    const x = 16 + i * 24, y = 28 + Math.floor(Math.random() * 6 - 3), rotate = Math.floor(Math.random() * 36 - 18), size = 24 + Math.floor(Math.random() * 8);
    return `<text x="${x}" y="${y}" font-size="${size}" font-weight="bold" font-family="Arial,Helvetica,sans-serif" fill="${colors[Math.floor(Math.random() * colors.length)]}" transform="rotate(${rotate} ${x} ${y})">${ch}</text>`;
  }).join('');
  const noise = Array.from({ length: 5 }, () => `<line x1="${Math.floor(Math.random() * 120)}" y1="${Math.floor(Math.random() * 44)}" x2="${Math.floor(Math.random() * 120)}" y2="${Math.floor(Math.random() * 44)}" stroke="#9aa5b1" stroke-width="1"/>`).join('');
  const dots = Array.from({ length: 40 }, () => `<circle cx="${Math.floor(Math.random() * 120)}" cy="${Math.floor(Math.random() * 44)}" r="1" fill="#9aa5b1"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44" viewBox="0 0 120 44"><rect width="120" height="44" fill="#eef1f5"/>${noise}${dots}${chars}</svg>`;
}

export class VerificationService {
  constructor(private db: PrismaClient, private redis: RedisLike, private messaging: MessagingService) {}
  async send(channel: CodeChannel, target: string, purpose: CodePurpose, ip: string) {
    const normalized = target.trim().toLowerCase(); const targetHash = sha256(normalized);
    const cooldown = `verify:cooldown:${channel}:${targetHash}`; const ipRate = `verify:ip:${ip}`;
    assert(!(await this.redis.exists(cooldown)), 'CODE_TOO_FREQUENT', '请在 60 秒后重试', 429);
    const count = await this.redis.incr(ipRate); if (count === 1) await this.redis.expire(ipRate, 3600);
    assert(count <= 20, 'IP_RATE_LIMITED', '此 IP 发送过于频繁，请稍后重试', 429);
    const code = randomCode();
    await this.db.verificationCode.create({ data: { channel, targetHash, codeHash: sha256(`${targetHash}:${code}`), purpose, expiresAt: new Date(Date.now() + 5 * 60_000), ip } });
    if (channel === 'EMAIL') await this.messaging.sendEmail(normalized, 'XLive 验证码', `您的验证码为 ${code}，5 分钟内有效。请勿将验证码告知他人。`);
    else await this.messaging.sendSmsForPurpose(normalized, purpose, code);
    await this.redis.set(cooldown, '1', { EX: 60 });
    return { expiresIn: 300, retryAfter: 60 };
  }

  async createCaptcha() {
    const id = randomToken(12);
    const text = Array.from({ length: 4 }, () => CAPTCHA_LETTERS[Math.floor(Math.random() * CAPTCHA_LETTERS.length)]).join('');
    await this.redis.set(captchaKey(id, text), '1', { EX: 300 });
    return { captchaId: id, image: `data:image/svg+xml;base64,${Buffer.from(renderCaptchaSvg(text)).toString('base64')}` };
  }

  async requireCaptcha(captchaId: string, captchaText: string) {
    const key = captchaKey(captchaId, captchaText.trim().toUpperCase());
    assert(await this.redis.exists(key), 'CAPTCHA_INVALID', '图形验证码不正确或已过期，请重新输入');
    await this.redis.expire(key, 1); // 一次性使用，立即失效
  }

  async verify(channel: CodeChannel, target: string, purpose: CodePurpose, code: string) {
    const targetHash = sha256(target.trim().toLowerCase());
    const record = await this.db.verificationCode.findFirst({ where: { channel, targetHash, purpose, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }, orderBy: { createdAt: 'desc' } });
    if (!record) throw new AppError('CODE_INVALID_OR_EXPIRED', '验证码无效或已过期');
    const valid = safeEqual(record.codeHash, sha256(`${targetHash}:${code}`));
    await this.db.verificationCode.update({ where: { id: record.id }, data: valid ? { usedAt: new Date() } : { attempts: { increment: 1 } } });
    if (!valid) throw new AppError('CODE_INVALID', '验证码不正确');
  }
}
