import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.APP_ENV === 'development' ? ['warn', 'error'] : ['error']
});
