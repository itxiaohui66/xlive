import { loadConfig } from './config.js';
import { prisma } from './lib/db.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config, prisma);
const stop = async () => { await app.close(); await prisma.$disconnect(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
await app.listen({ host: '0.0.0.0', port: config.APP_PORT });
