import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { RedisLike } from '../lib/redis.js';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { SettingsService } from './settings.service.js';
import { qualitySlug, type QualitySetting, type TranscoderService } from './transcoder.service.js';
import { authenticate } from '../lib/auth.js';
import { AppError, assert } from '../lib/errors.js';
import { decrypt, encrypt, randomToken, sha256 } from '../lib/crypto.js';

const roomInclude = { owner: { select: { id: true, username: true, nickname: true, avatar: true } }, category: true } as const;
const flvUrl = (path: string, flvHost: string) => flvHost ? `//${flvHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')}${path}` : path;
const qualitiesFor = (n: number, configs: QualitySetting[], src: { width: number; height: number } | undefined, flvHost: string) => [{ label: '原画', flv: flvUrl(`/live/room_${n}.flv`, flvHost), hls: `/live/room_${n}.m3u8` }, ...configs.filter(q => q.enabled !== false).filter(q => !src || (q.width < src.width && q.height < src.height)).map(q => ({ label: q.label, flv: flvUrl(`/transcode/live/room_${n}_${qualitySlug(q.label)}.flv`, flvHost), hls: `/live/room_${n}_${qualitySlug(q.label)}.m3u8` }))];
const roomInput = z.object({ title: z.string().min(1).max(120), description: z.string().max(1000).optional(), cover: z.string().max(500).optional(), announcement: z.string().max(1000).optional(), categoryId: z.number().int().positive().nullable().optional(), visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'), showViewerCount: z.boolean().default(true), recordReplay: z.boolean().optional() });

export async function roomRoutes(app: FastifyInstance, deps: { db: PrismaClient; redis: RedisLike; config: AppConfig; settings: SettingsService; transcoder: TranscoderService }) {
  const { db, redis, config, settings, transcoder } = deps;

  app.get('/api/rooms', async request => {
    const q = z.object({ category: z.string().optional(), search: z.string().max(100).optional(), status: z.enum(['LIVE', 'OFFLINE']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const where = { visibility: 'PUBLIC' as const, ...(q.status ? { streamStatus: q.status } : {}), ...(q.category ? { category: { slug: q.category, enabled: true } } : {}), ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' as const } }, { owner: { nickname: { contains: q.search, mode: 'insensitive' as const } } }] } : {}) };
    const [items, total] = await Promise.all([db.room.findMany({ where, include: roomInclude, orderBy: [{ featured: 'desc' }, { streamStatus: 'desc' }, { viewerCount: 'desc' }, { lastLiveAt: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit }), db.room.count({ where })]);
    return { data: items, meta: { page: q.page, limit: q.limit, total } };
  });

  app.get('/api/rooms/:roomNumber', async request => {
    const { roomNumber } = z.object({ roomNumber: z.coerce.number().int() }).parse(request.params);
    const room = await db.room.findUnique({ where: { roomNumber }, include: roomInclude }); assert(room, 'ROOM_NOT_FOUND', '直播间不存在', 404);
    if (!(await settings.get<boolean>('auth.guestViewing', true)) && !request.cookies.xlive_access) throw new AppError('LOGIN_REQUIRED', '登录后才能观看直播', 401);
    const [protocol, flvHost, transcodeQualities] = await Promise.all([settings.get<'FLV' | 'HLS'>('live.playback.protocol', 'FLV'), settings.get<string>('live.playback.flvHost', ''), settings.get<QualitySetting[]>('live.transcode.qualities', [])]);
    const qualities = qualitiesFor(room.roomNumber, transcodeQualities, transcoder.probeOf(`room_${room.roomNumber}`), flvHost);
    return { data: { ...room, playback: room.streamStatus === 'LIVE' ? { ...qualities[0]!, qualities, protocol } : null } };
  });

  app.get('/api/categories', async () => ({ data: await db.category.findMany({ where: { enabled: true }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] }) }));

  app.post('/api/rooms', { preHandler: authenticate }, async (request, reply) => {
    const input = roomInput.parse(request.body); const user = await db.user.findUniqueOrThrow({ where: { id: request.auth!.userId } });
    assert(user.canStream && user.status === 'ACTIVE', 'STREAM_PERMISSION_DENIED', '当前账号没有直播权限', 403); assert(await settings.get<boolean>('live.allowRegisteredUsers', true), 'STREAM_CREATION_DISABLED', '平台暂未开放创建直播间', 403);
    const max = await settings.get<number>('live.maxPerUser', 1); assert(await db.room.count({ where: { ownerId: user.id } }) < max, 'ROOM_LIMIT_REACHED', `每个用户最多可创建 ${max} 个直播间`, 409);
    const rawKey = randomToken(32); const room = await db.room.create({ data: { ...input, ownerId: user.id, streamKey: { create: { keyHash: sha256(rawKey), keyCipher: encrypt(rawKey, config.CONFIG_ENCRYPTION_KEY), keyHint: rawKey.slice(-6) } } }, include: roomInclude });
    reply.code(201).send({ data: room });
  });

  app.get('/api/users/me/rooms', { preHandler: authenticate }, async request => ({ data: await db.room.findMany({ where: { ownerId: request.auth!.userId }, include: { ...roomInclude, sessions: { orderBy: { startedAt: 'desc' }, take: 20, select: { id: true, startedAt: true, endedAt: true, durationSeconds: true, peakViewers: true, totalViews: true, recordingUrl: true } } } }) }));

  app.get('/api/rooms/:roomNumber/replays', async request => {
    const { roomNumber } = z.object({ roomNumber: z.coerce.number().int() }).parse(request.params);
    const room = await db.room.findUnique({ where: { roomNumber } }); assert(room, 'ROOM_NOT_FOUND', '直播间不存在', 404);
    const sessions = await db.liveSession.findMany({ where: { roomId: room.id, endedAt: { not: null }, recordingUrl: { not: null } }, orderBy: { startedAt: 'desc' }, take: 50, select: { id: true, startedAt: true, endedAt: true, durationSeconds: true, peakViewers: true, totalViews: true, recordingUrl: true } });
    return { data: sessions };
  });

  app.get('/api/replays', async request => {
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const where = { endedAt: { not: null }, recordingUrl: { not: null }, room: { visibility: 'PUBLIC' as const } };
    const [items, total] = await Promise.all([db.liveSession.findMany({ where, select: { id: true, startedAt: true, endedAt: true, durationSeconds: true, peakViewers: true, totalViews: true, recordingUrl: true, room: { select: { roomNumber: true, title: true, cover: true } } }, orderBy: { startedAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }), db.liveSession.count({ where })]);
    return { data: items, meta: { page: q.page, limit: q.limit, total } };
  });

  app.post('/api/notices/stream-permission', { preHandler: authenticate }, async (request, reply) => {
    const input = z.object({ content: z.string().max(1000).optional() }).parse(request.body);
    const user = await db.user.findUniqueOrThrow({ where: { id: request.auth!.userId } });
    assert(!user.canStream, 'STREAM_PERMISSION_GRANTED', '您已拥有开播权限');
    const pending = await db.notice.findFirst({ where: { fromId: user.id, status: 'PENDING' } });
    assert(!pending, 'APPLICATION_PENDING', '已有待审核的申请，请耐心等待');
    const notice = await db.notice.create({ data: { fromId: user.id, content: input.content?.trim() || '申请开播权限' } });
    reply.code(201).send({ data: notice });
  });

  app.get('/api/notices/stream-permission', { preHandler: authenticate }, async request => ({ data: await db.notice.findFirst({ where: { fromId: request.auth!.userId }, orderBy: { createdAt: 'desc' } }) }));

  app.get('/api/replays/:sessionId/danmaku', async request => {
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const session = await db.liveSession.findUnique({ where: { id: sessionId }, select: { id: true, recordingUrl: true } }); assert(session?.recordingUrl, 'REPLAY_NOT_FOUND', '直播回放不存在', 404);
    const messages = await db.chatMessage.findMany({ where: { sessionId, deletedAt: null, offsetSeconds: { not: null } }, orderBy: { offsetSeconds: 'asc' }, select: { id: true, nickname: true, avatar: true, content: true, createdAt: true, offsetSeconds: true } });
    return { data: messages };
  });

  app.patch('/api/rooms/:roomNumber', { preHandler: authenticate }, async request => {
    const { roomNumber } = z.object({ roomNumber: z.coerce.number().int() }).parse(request.params); const room = await db.room.findUnique({ where: { roomNumber } }); assert(room, 'ROOM_NOT_FOUND', '直播间不存在', 404); assert(room.ownerId === request.auth!.userId || request.auth!.roles.some(r => r !== 'USER'), 'FORBIDDEN', '无权修改此直播间', 403);
    return { data: await db.room.update({ where: { id: room.id }, data: roomInput.partial().parse(request.body), include: roomInclude }) };
  });

  app.get('/api/rooms/:roomNumber/stream', { preHandler: authenticate }, async request => {
    const { roomNumber } = z.object({ roomNumber: z.coerce.number().int() }).parse(request.params); const room = await db.room.findUnique({ where: { roomNumber }, include: { streamKey: true } }); assert(room, 'ROOM_NOT_FOUND', '直播间不存在', 404); assert(room.ownerId === request.auth!.userId, 'FORBIDDEN', '只能查看自己的推流信息', 403); assert(room.streamKey, 'STREAM_KEY_MISSING', '推流密钥不存在', 500);
    const key = decrypt(room.streamKey.keyCipher, config.CONFIG_ENCRYPTION_KEY); const [protocol, flvHost] = await Promise.all([settings.get<'FLV' | 'HLS'>('live.playback.protocol', 'FLV'), settings.get<string>('live.playback.flvHost', '')]);
    const server = config.RTMP_PUBLIC_URL || `rtmp://${request.hostname}:${config.RTMP_PORT}/live`;
    return { data: { server, streamKey: `room_${room.roomNumber}?token=${key}`, keyHint: room.streamKey.keyHint, playback: protocol === 'FLV' ? flvUrl(`/live/room_${room.roomNumber}.flv`, flvHost) : `/live/room_${room.roomNumber}.m3u8` } };
  });

  app.post('/api/rooms/:roomNumber/stream/rotate', { preHandler: authenticate }, async request => {
    const { roomNumber } = z.object({ roomNumber: z.coerce.number().int() }).parse(request.params); const room = await db.room.findUnique({ where: { roomNumber }, include: { streamKey: true } }); assert(room && room.streamKey, 'ROOM_NOT_FOUND', '直播间不存在', 404); assert(room.ownerId === request.auth!.userId, 'FORBIDDEN', '只能重置自己的推流密钥', 403);
    const raw = randomToken(32); await db.streamKey.update({ where: { roomId: room.id }, data: { keyHash: sha256(raw), keyCipher: encrypt(raw, config.CONFIG_ENCRYPTION_KEY), keyHint: raw.slice(-6), version: { increment: 1 }, rotatedAt: new Date() } });
    if (room.streamStatus === 'LIVE') await stopSrsStream(config, `room_${roomNumber}`); return { data: { streamKey: `room_${roomNumber}?token=${raw}` } };
  });

  app.post('/api/rooms/:roomNumber/viewers/heartbeat', async (request, reply) => {
    const { roomNumber } = z.object({ roomNumber: z.coerce.number().int() }).parse(request.params); const room = await db.room.findUnique({ where: { roomNumber } }); assert(room, 'ROOM_NOT_FOUND', '直播间不存在', 404);
    let viewer = request.cookies.xlive_viewer; if (!viewer) { viewer = randomToken(18); reply.setCookie('xlive_viewer', viewer, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 86400 }); }
    const key = `viewers:${room.id}`; const now = Date.now(); await redis.zAdd(key, { score: now + 45_000, value: viewer }); await redis.zRemRangeByScore(key, 0, now); await redis.expire(key, 120); const count = await redis.zCard(key);
    await db.room.update({ where: { id: room.id }, data: { viewerCount: count } }); const session = await db.liveSession.findFirst({ where: { roomId: room.id, endedAt: null }, orderBy: { startedAt: 'desc' } }); if (session) await db.liveSession.update({ where: { id: session.id }, data: { peakViewers: Math.max(session.peakViewers, count), viewerSeconds: { increment: BigInt(count * 15) }, viewerSamples: { increment: 1 } } });
    return { data: { viewerCount: room.showViewerCount ? count : null } };
  });
}

export async function stopSrsStream(config: AppConfig, streamName: string) {
  const response = await fetch(`${config.SRS_API_URL}/api/v1/streams?count=100`); if (!response.ok) return false;
  const body = await response.json() as { streams?: Array<{ name: string; publish?: { cid?: number } }> }; const stream = body.streams?.find(s => s.name === streamName); const cid = stream?.publish?.cid; if (!cid) return false;
  const stopped = await fetch(`${config.SRS_API_URL}/api/v1/clients/${cid}`, { method: 'DELETE' }); return stopped.ok;
}
