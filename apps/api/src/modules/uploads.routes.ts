import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../config.js';
import { authenticate } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';

function detectedExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer.length > 12 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP') return 'webp';
  return null;
}

export async function uploadRoutes(app: FastifyInstance, deps: { db: PrismaClient; config: AppConfig }) {
  const { db, config } = deps;
  app.post('/api/uploads/images', { preHandler: authenticate }, async request => {
    const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
    if (!file) throw new AppError('FILE_REQUIRED', '请选择图片文件');
    const buffer = await file.toBuffer(); const extension = detectedExtension(buffer);
    if (!extension || !['image/jpeg','image/png','image/webp'].includes(file.mimetype)) throw new AppError('INVALID_IMAGE', '仅支持 JPG、PNG、WebP 图片');
    await mkdir(config.UPLOAD_DIR, { recursive: true }); const name = `${randomToken(20)}.${extension}`; await writeFile(join(config.UPLOAD_DIR, name), buffer, { flag: 'wx' });
    const upload = await db.upload.create({ data: { filename: name, originalName: file.filename?.slice(0, 255), mimeType: file.mimetype, size: buffer.length, uploaderId: request.auth!.userId, url: `/uploads/${name}` } });
    return { data: { id: upload.id, url: upload.url } };
  });
}
