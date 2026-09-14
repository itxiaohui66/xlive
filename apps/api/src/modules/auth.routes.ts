import type { FastifyInstance } from 'fastify';
import type { PrismaClient, RoleName } from '@prisma/client';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { SettingsService } from './settings.service.js';
import type { VerificationService } from './verification.service.js';
import { AppError, assert } from '../lib/errors.js';
import { hashPassword, validatePassword, verifyPassword } from '../lib/password.js';
import { clearAuthCookies, authenticate, setAccessCookie, setRefreshCookie } from '../lib/auth.js';
import { randomToken, sha256 } from '../lib/crypto.js';

const registerSchema = z.object({ username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/), nickname: z.string().min(1).max(64), email: z.string().email().optional(), phone: z.string().regex(/^\+?\d{7,15}$/).optional(), password: z.string().min(1), emailCode: z.string().length(6).optional(), smsCode: z.string().length(6).optional() });
const loginSchema = z.object({ account: z.string().min(1).max(254), password: z.string().min(1).max(128) });

function safeUser(user: { id: string; username: string; nickname: string; avatar: string | null; email: string | null; phone: string | null; status: string; canStream: boolean; createdAt: Date; roles: { role: { name: RoleName } }[] }) {
  return { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar, email: user.email, phone: user.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : null, status: user.status, canStream: user.canStream, createdAt: user.createdAt, roles: user.roles.map(r => r.role.name) };
}

export async function authRoutes(app: FastifyInstance, deps: { db: PrismaClient; config: AppConfig; settings: SettingsService; verification: VerificationService }) {
  const { db, config, settings, verification } = deps;

  app.post('/api/auth/register', async (request, reply) => {
    const input = registerSchema.parse(request.body); const options = await settings.all(false);
    const emailEnabled = Boolean(options['auth.register.email']); const smsEnabled = Boolean(options['auth.register.sms']);
    assert(emailEnabled || smsEnabled, 'REGISTRATION_DISABLED', '网站暂未开放注册', 403);
    assert(!input.email || emailEnabled, 'EMAIL_REGISTRATION_DISABLED', '未开放邮箱注册');
    assert(!input.phone || smsEnabled, 'SMS_REGISTRATION_DISABLED', '未开放手机号注册');
    const rule = String(options['auth.register.rule'] ?? 'ANY');
    if (emailEnabled && smsEnabled && rule === 'ALL') assert(input.email && input.phone, 'CONTACT_REQUIRED', '邮箱和手机号均为必填项');
    else assert((emailEnabled && input.email) || (smsEnabled && input.phone), 'CONTACT_REQUIRED', '请填写可用的邮箱或手机号');
    if (options['auth.register.requireVerification']) {
      if (rule === 'ALL') { assert(input.emailCode && input.smsCode, 'VERIFICATION_CODE_REQUIRED', '请输入邮箱和短信验证码'); await verification.verify('EMAIL', input.email!, 'REGISTER', input.emailCode); await verification.verify('SMS', input.phone!, 'REGISTER', input.smsCode); }
      else if (input.email && input.emailCode) await verification.verify('EMAIL', input.email, 'REGISTER', input.emailCode);
      else if (input.phone && input.smsCode) await verification.verify('SMS', input.phone, 'REGISTER', input.smsCode);
      else throw new AppError('VERIFICATION_CODE_REQUIRED', '请至少完成一种验证码验证');
    }
    validatePassword(input.password, await settings.passwordPolicy());
    const existing = await db.user.findFirst({ where: { OR: [{ username: input.username }, ...(input.email ? [{ email: input.email.toLowerCase() }] : []), ...(input.phone ? [{ phone: input.phone }] : [])] } });
    assert(!existing, 'ACCOUNT_EXISTS', '用户名、邮箱或手机号已被使用', 409);
    const canStream = await settings.get<boolean>('live.newUserCanStream', false);
    const user = await db.user.create({ data: { username: input.username, nickname: input.nickname, email: input.email?.toLowerCase(), phone: input.phone, passwordHash: await hashPassword(input.password), canStream, registerIp: request.ip, roles: { create: { role: { connect: { name: 'USER' } } } } }, include: { roles: { include: { role: true } } } });
    reply.code(201).send({ data: safeUser(user) });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body); const now = new Date();
    const user = await db.user.findFirst({ where: { OR: [{ username: input.account }, { email: input.account.toLowerCase() }, { phone: input.account }] }, include: { roles: { include: { role: true } } } });
    const fail = async (reason: string) => {
      await db.loginLog.create({ data: { userId: user?.id, account: input.account, success: false, reason, ip: request.ip, userAgent: request.headers['user-agent'] } });
      throw new AppError('INVALID_CREDENTIALS', '账号或密码错误', 401);
    };
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      if (user) { const max = await settings.get<number>('security.loginMaxFailures', 5); const lockMinutes = await settings.get<number>('security.loginLockMinutes', 15); const count = user.failedLoginCount + 1; await db.user.update({ where: { id: user.id }, data: { failedLoginCount: count >= max ? 0 : count, lockedUntil: count >= max ? new Date(Date.now() + lockMinutes * 60_000) : undefined } }); }
      return fail('BAD_PASSWORD');
    }
    if (user.status !== 'ACTIVE') throw new AppError('ACCOUNT_DISABLED', '账号已被禁用', 403);
    if (user.lockedUntil && user.lockedUntil > now) throw new AppError('ACCOUNT_TEMPORARILY_LOCKED', `账号暂时锁定至 ${user.lockedUntil.toISOString()}`, 423);
    const roles = user.roles.map(r => r.role.name);
    const access = await reply.jwtSign({ sub: user.id, roles, type: 'access' }, { expiresIn: '15m' }); const refresh = randomToken(48);
    await db.$transaction([db.refreshToken.create({ data: { userId: user.id, tokenHash: sha256(refresh), expiresAt: new Date(Date.now() + 30 * 86400_000), ip: request.ip } }), db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, lastLoginIp: request.ip } }), db.loginLog.create({ data: { userId: user.id, account: input.account, success: true, ip: request.ip, userAgent: request.headers['user-agent'] } })]);
    setAccessCookie(reply, access, config.COOKIE_SECURE); setRefreshCookie(reply, refresh, config.COOKIE_SECURE);
    return { data: safeUser(user) };
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const token = request.cookies.xlive_refresh; assert(token, 'REFRESH_REQUIRED', '登录状态已过期', 401);
    const record = await db.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { roles: { include: { role: true } } } } } });
    assert(record && !record.revokedAt && record.expiresAt > new Date() && record.user.status === 'ACTIVE', 'REFRESH_INVALID', '登录状态已过期', 401);
    const roles = record.user.roles.map(r => r.role.name); const access = await reply.jwtSign({ sub: record.userId, roles, type: 'access' }, { expiresIn: '15m' });
    setAccessCookie(reply, access, config.COOKIE_SECURE); return { data: { refreshed: true } };
  });

  app.post('/api/auth/logout', async (request, reply) => { const token = request.cookies.xlive_refresh; if (token) await db.refreshToken.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } }); clearAuthCookies(reply); return { data: { loggedOut: true } }; });
  app.get('/api/users/me', { preHandler: authenticate }, async request => { const user = await db.user.findUniqueOrThrow({ where: { id: request.auth!.userId }, include: { roles: { include: { role: true } } } }); return { data: safeUser(user) }; });
  app.patch('/api/users/me', { preHandler: authenticate }, async request => { const input = z.object({ nickname: z.string().min(1).max(64).optional(), bio: z.string().max(500).optional(), avatar: z.string().max(500).refine(v => v === '' || /^https?:\/\/\S+$/.test(v) || v.startsWith('/uploads/'), '头像必须是有效的图片链接').optional() }).parse(request.body); const user = await db.user.update({ where: { id: request.auth!.userId }, data: { ...input, avatar: input.avatar === '' ? null : input.avatar }, include: { roles: { include: { role: true } } } }); return { data: safeUser(user) }; });
  app.post('/api/auth/change-password', { preHandler: authenticate }, async request => { const input = z.object({ currentPassword: z.string(), newPassword: z.string() }).parse(request.body); const user = await db.user.findUniqueOrThrow({ where: { id: request.auth!.userId } }); assert(await verifyPassword(user.passwordHash, input.currentPassword), 'CURRENT_PASSWORD_INVALID', '当前密码不正确'); validatePassword(input.newPassword, await settings.passwordPolicy()); await db.$transaction([db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } }), db.refreshToken.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } })]); return { data: { changed: true } }; });
  app.get('/api/auth/captcha', async () => ({ data: await verification.createCaptcha() }));
  app.post('/api/auth/email/send-code', async request => { const input = z.object({ email: z.string().email(), purpose: z.enum(['REGISTER', 'LOGIN', 'RESET_PASSWORD']).default('REGISTER'), captchaId: z.string().min(8), captchaText: z.string().min(4).max(8) }).parse(request.body); await verification.requireCaptcha(input.captchaId, input.captchaText); return { data: await verification.send('EMAIL', input.email, input.purpose, request.ip) }; });
  app.post('/api/auth/sms/send-code', async request => { const input = z.object({ phone: z.string().regex(/^\+?\d{7,15}$/), purpose: z.enum(['REGISTER', 'LOGIN', 'RESET_PASSWORD']).default('REGISTER'), captchaId: z.string().min(8), captchaText: z.string().min(4).max(8) }).parse(request.body); await verification.requireCaptcha(input.captchaId, input.captchaText); return { data: await verification.send('SMS', input.phone, input.purpose, request.ip) }; });
  app.post('/api/auth/reset-password', async request => { const input = z.object({ channel: z.enum(['EMAIL', 'SMS']), target: z.string(), code: z.string().length(6), newPassword: z.string() }).parse(request.body); await verification.verify(input.channel, input.target, 'RESET_PASSWORD', input.code); validatePassword(input.newPassword, await settings.passwordPolicy()); const where = input.channel === 'EMAIL' ? { email: input.target.toLowerCase() } : { phone: input.target }; const user = await db.user.findFirst({ where }); assert(user, 'ACCOUNT_NOT_FOUND', '账号不存在', 404); await db.$transaction([db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } }), db.refreshToken.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } })]); return { data: { reset: true } }; });
}
