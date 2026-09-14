import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { assert } from '../lib/errors.js';
import { sha256, safeEqual } from '../lib/crypto.js';
import type { SettingsService } from './settings.service.js';
import type { TranscoderService } from './transcoder.service.js';

const hookSchema = z.object({ action: z.string(), client_id: z.union([z.string(), z.number()]).optional(), ip: z.string().optional(), vhost: z.string().optional(), app: z.string(), stream: z.string(), param: z.string().optional(), file: z.string().optional(), duration: z.coerce.number().optional(), cwd: z.string().optional() });

export async function mediaRoutes(app: FastifyInstance, deps: { db: PrismaClient; config: AppConfig; settings?: SettingsService; transcoder?: TranscoderService }) {
  const { db, config, settings, transcoder } = deps;
  app.post('/api/media/hooks', async (request, reply) => {
    const secret = (request.query as { secret?: string }).secret ?? ''; assert(safeEqual(secret, config.SRS_HOOK_SECRET), 'HOOK_UNAUTHORIZED', '无效的媒体服务器签名', 401);
    const hook = hookSchema.parse(request.body); const match = /^room_(\d+)$/.exec(hook.stream); assert(match, 'STREAM_NAME_INVALID', '无效的流名称', 403); const roomNumber = Number(match[1]);
    const room = await db.room.findUnique({ where: { roomNumber }, include: { owner: true, streamKey: true } }); assert(room && room.streamKey, 'STREAM_NOT_FOUND', '推流目标不存在', 403);
    if (hook.action === 'on_publish') {
      const params = new URLSearchParams((hook.param ?? '').replace(/^\?/, '')); const token = params.get('token') ?? '';
      assert(token && safeEqual(sha256(token), room.streamKey.keyHash), 'STREAM_KEY_INVALID', 'Stream Key 无效', 403);
      assert(room.owner.status === 'ACTIVE' && room.owner.canStream && !room.liveBanned, 'STREAM_PERMISSION_DENIED', '账号或直播间已被禁止直播', 403);
      const active = await db.room.count({ where: { streamStatus: 'LIVE' } }); const maximum = settings ? await settings.get<number>('live.maxConcurrent', 100) : 100;
      assert(room.streamStatus === 'LIVE' || active < maximum, 'STREAM_CAPACITY_REACHED', '平台同时直播数量已达到上限', 503);
      await db.$transaction(async tx => {
        await tx.liveSession.updateMany({ where: { roomId: room.id, endedAt: null }, data: { endedAt: new Date() } });
        await tx.liveSession.create({ data: { roomId: room.id, streamName: hook.stream, srsClientId: hook.client_id ? String(hook.client_id) : null, recordEnabled: room.recordReplay } });
        await tx.room.update({ where: { id: room.id }, data: { streamStatus: 'LIVE', lastLiveAt: new Date(), viewerCount: 0 } });
      });
      if (transcoder) void transcoder.onPublish(hook.stream).catch(error => request.log.error({ err: error }, 'transcoder onPublish failed'));
    }
    if (hook.action === 'on_unpublish') {
      if (transcoder) transcoder.onUnpublish(hook.stream);
      const session = await db.liveSession.findFirst({ where: { roomId: room.id, endedAt: null }, orderBy: { startedAt: 'desc' } }); const endedAt = new Date();
      await db.$transaction([db.room.update({ where: { id: room.id }, data: { streamStatus: room.liveBanned ? 'BANNED' : 'OFFLINE', viewerCount: 0 } }), ...(session ? [db.liveSession.update({ where: { id: session.id }, data: { endedAt, durationSeconds: Math.max(0, Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000)) } })] : [])]);
    }
    if (hook.action === 'on_dvr' && hook.file) {
      const fileName = hook.file.split(/[\\/]/).pop();
      assert(fileName && /^room_\d+\.\d+\.flv$/.test(fileName), 'RECORDING_PATH_INVALID', '回放文件路径无效', 422);
      const session = await db.liveSession.findFirst({ where: { roomId: room.id }, orderBy: { startedAt: 'desc' } });
      if (session && !session.recordEnabled) {
        unlink(join(config.LIVE_DIR, 'replays', fileName)).catch(error => request.log.error({ err: error }, 'delete replay file failed'));
      } else if (session) {
        const size = await stat(join(config.LIVE_DIR, 'replays', fileName)).then(s => s.size).catch(() => null);
        await db.liveSession.update({ where: { id: session.id }, data: { recordingUrl: `/live/replays/${fileName}`, ...(size != null ? { recordingSize: size } : {}), ...(hook.duration && !session.durationSeconds ? { durationSeconds: Math.round(hook.duration) } : {}) } });
      }
    }
    reply.type('application/json').send(0);
  });
}
