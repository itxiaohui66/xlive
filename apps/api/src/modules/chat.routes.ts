import type { FastifyInstance } from 'fastify';
import type { PrismaClient, RoleName } from '@prisma/client';
import type { WebSocket } from 'ws';
import { z } from 'zod';

type Client = { socket: WebSocket; userId: string | null; nickname: string; avatar: string | null; roles: RoleName[] };
const rooms = new Map<number, Set<Client>>();

export async function chatRoutes(app: FastifyInstance, db: PrismaClient) {
  app.get('/api/rooms/:roomNumber/chat', { websocket: true }, async (socket, request) => {
    const roomNumber = Number((request.params as { roomNumber: string }).roomNumber);
    const room = await db.room.findUnique({ where: { roomNumber } });
    if (!room) { socket.send(JSON.stringify({ type: 'error', message: '直播间不存在' })); socket.close(1008); return; }

    let user: { id: string; nickname: string; avatar: string | null; status: string } | null = null;
    let roles: RoleName[] = [];
    try {
      const token = await request.jwtVerify<{ sub: string; roles: RoleName[] }>();
      roles = token.roles;
      const [account, ban] = await Promise.all([
        db.user.findUnique({ where: { id: token.sub }, select: { id: true, nickname: true, avatar: true, status: true } }),
        db.ban.findFirst({ where: { userId: token.sub, type: 'CHAT', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
      ]);
      if (!account || account.status !== 'ACTIVE' || ban) { socket.send(JSON.stringify({ type: 'error', message: ban ? '您已被禁言' : '账号当前无法参与聊天' })); socket.close(1008); return; }
      user = account;
    } catch { /* 游客可接收聊天和弹幕，但不能发送。 */ }

    const client: Client = { socket, userId: user?.id ?? null, nickname: user?.nickname ?? '游客', avatar: user?.avatar ?? null, roles };
    if (!rooms.has(roomNumber)) rooms.set(roomNumber, new Set()); rooms.get(roomNumber)!.add(client);
    const history = await db.chatMessage.findMany({ where: { roomId: room.id, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 });
    socket.send(JSON.stringify({ type: 'history', messages: history.reverse() }));
    socket.on('message', async raw => {
      if (!user) { socket.send(JSON.stringify({ type: 'error', message: '请先登录后参与聊天' })); return; }
      try {
        const { content } = z.object({ content: z.string().trim().min(1).max(500) }).parse(JSON.parse(raw.toString()));
        const session = await db.liveSession.findFirst({ where: { roomId: room.id, endedAt: null }, orderBy: { startedAt: 'desc' } });
        const message = await db.chatMessage.create({ data: { roomId: room.id, userId: user.id, nickname: user.nickname, avatar: user.avatar, content, sessionId: session?.id, offsetSeconds: session ? Math.max(0, (Date.now() - session.startedAt.getTime()) / 1000) : null } });
        const event = JSON.stringify({ type: 'message', message });
        for (const peer of rooms.get(roomNumber) ?? []) if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(event);
      } catch { socket.send(JSON.stringify({ type: 'error', message: '消息格式不正确或发送失败' })); }
    });
    socket.on('close', () => { rooms.get(roomNumber)?.delete(client); if (!rooms.get(roomNumber)?.size) rooms.delete(roomNumber); });
  });
}
