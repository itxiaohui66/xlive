import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RoleName } from '@prisma/client';
import { AppError } from './errors.js';

type TokenPayload = { sub: string; roles: RoleName[]; type: 'access' };

export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    const payload = await request.jwtVerify<TokenPayload>();
    if (payload.type !== 'access') throw new Error('wrong token type');
    request.auth = { userId: payload.sub, roles: payload.roles };
  } catch { throw new AppError('UNAUTHORIZED', '请先登录', 401); }
}

export const requireRoles = (...roles: RoleName[]) => async (request: FastifyRequest) => {
  await authenticate(request);
  if (!roles.some(role => request.auth!.roles.includes(role))) throw new AppError('FORBIDDEN', '没有执行此操作的权限', 403);
};

export function setAccessCookie(reply: FastifyReply, token: string, secure: boolean) {
  reply.setCookie('xlive_access', token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 15 * 60 });
}

export function setRefreshCookie(reply: FastifyReply, token: string, secure: boolean) {
  reply.setCookie('xlive_refresh', token, { httpOnly: true, secure, sameSite: 'strict', path: '/api/auth', maxAge: 30 * 24 * 3600 });
}

export function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie('xlive_access', { path: '/' });
  reply.clearCookie('xlive_refresh', { path: '/api/auth' });
}
