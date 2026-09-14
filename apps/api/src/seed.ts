import { PrismaClient } from '@prisma/client';
import { hashPassword } from './lib/password.js';

const db = new PrismaClient();
for (const role of ['USER', 'ADMIN', 'SUPER_ADMIN'] as const) await db.role.upsert({ where: { name: role }, update: {}, create: { name: role, description: role } });
const categories = [['游戏', 'games', 'game-controller'], ['聊天', 'chat', 'chatbubbles'], ['音乐', 'music', 'musical-notes'], ['学习', 'study', 'book'], ['户外', 'outdoors', 'bicycle'], ['体育', 'sports', 'football'], ['其他', 'other', 'apps']] as const;
for (const [name, slug, icon] of categories) await db.category.upsert({ where: { slug }, update: {}, create: { name, slug, icon } });
const username = process.env.ADMIN_USERNAME ?? 'admin'; const email = process.env.ADMIN_EMAIL ?? 'admin@example.com'; const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error('ADMIN_PASSWORD is required for first startup');
const existing = await db.user.findFirst({ where: { OR: [{ username }, { email }] } });
if (!existing) await db.user.create({ data: { username, nickname: '超级管理员', email, passwordHash: await hashPassword(password), roles: { create: { role: { connect: { name: 'SUPER_ADMIN' } } } } } });
await db.$disconnect();
