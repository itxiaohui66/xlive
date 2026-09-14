import type { RoleName } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; roles: RoleName[] };
  }
}
