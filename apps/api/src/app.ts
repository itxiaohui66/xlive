import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { createClient } from 'redis';
import { ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';
import { AppError } from './lib/errors.js';
import { SettingsService } from './modules/settings.service.js';
import { MessagingService } from './modules/messaging.service.js';
import { VerificationService } from './modules/verification.service.js';
import { TranscoderService } from './modules/transcoder.service.js';
import { authRoutes } from './modules/auth.routes.js';
import { roomRoutes } from './modules/rooms.routes.js';
import { mediaRoutes } from './modules/media.routes.js';
import { adminRoutes } from './modules/admin.routes.js';
import { chatRoutes } from './modules/chat.routes.js';
import { uploadRoutes } from './modules/uploads.routes.js';

export async function buildApp(config: AppConfig, db: PrismaClient) {
  const app = Fastify({
    logger: { level: config.APP_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.accessKeySecret', '*.streamKey'] },
    genReqId: req => String(req.headers['x-request-id'] ?? crypto.randomUUID())
  });
  const redis = createClient({ url: config.REDIS_URL });
  redis.on('error', error => app.log.error({ err: error }, 'Redis connection error'));
  await redis.connect();
  const settings = new SettingsService(db, config);
  const messaging = new MessagingService(settings);
  const verification = new VerificationService(db, redis, messaging);
  const transcoder = new TranscoderService(settings);

  await app.register(cookie);
  await app.register(cors, { origin: config.APP_ENV === 'development' ? true : false, credentials: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(jwt, { secret: config.JWT_SECRET, cookie: { cookieName: 'xlive_access', signed: false } });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', keyGenerator: request => request.ip });
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(swagger, { openapi: { info: { title: 'XLive API', version: '1.0.0', description: 'XLive 多用户直播平台 REST API' }, tags: [{ name: 'auth' }, { name: 'rooms' }, { name: 'admin' }] } });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.addHook('onSend', async (request, reply, payload) => { reply.header('x-request-id', request.id); return payload; });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(422).send({ code: 'VALIDATION_ERROR', message: '请求参数不正确', details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })), requestId: request.id });
    if (error instanceof AppError) return reply.code(error.status).send({ code: error.code, message: error.message, requestId: request.id });
    if ((error as { code?: string }).code === 'P2002') return reply.code(409).send({ code: 'DUPLICATE_RESOURCE', message: '数据已存在', requestId: request.id });
    if ((error as { statusCode?: number }).statusCode && (error as { statusCode: number }).statusCode < 500) return reply.code((error as { statusCode: number }).statusCode).send({ code: 'BAD_REQUEST', message: '请求格式不正确', requestId: request.id });
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: '服务器内部错误', requestId: request.id });
  });

  app.get('/health', async (_request, reply) => {
    try { await db.$queryRaw`SELECT 1`; await redis.ping(); return { status: 'ok', components: { application: 'up', database: 'up', redis: 'up' } }; }
    catch { return reply.code(503).send({ status: 'degraded' }); }
  });
  app.get('/api/settings/public', async () => ({ data: await settings.publicSettings() }));

  await authRoutes(app, { db, config, settings, verification });
  await roomRoutes(app, { db, redis, config, settings, transcoder });
  await mediaRoutes(app, { db, config, settings, transcoder });
  await chatRoutes(app, db);
  await uploadRoutes(app, { db, config });
  await adminRoutes(app, { db, redis, config, settings, messaging });

  app.addHook('onClose', async () => { await redis.quit(); });
  return app;
}
