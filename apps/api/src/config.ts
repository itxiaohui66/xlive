import { z } from 'zod';

const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  CONFIG_ENCRYPTION_KEY: z.string().min(16),
  COOKIE_SECURE: z.string().default('false').transform(v => v === 'true'),
  ADMIN_USERNAME: z.string().min(3).default('admin'),
  ADMIN_PASSWORD: z.string().min(8),
  ADMIN_EMAIL: z.string().email(),
  SRS_API_URL: z.string().url().default('http://srs:1985'),
  SRS_HOOK_SECRET: z.string().min(12),
  RTMP_PUBLIC_URL: z.string().default(''),
  RTMP_PORT: z.coerce.number().int().min(1).max(65535).default(1935),
  HLS_PUBLIC_URL: z.string().default('http://localhost/live'),
  UPLOAD_DIR: z.string().default('./uploads'),
  LIVE_DIR: z.string().default('./live')
});

export type AppConfig = z.infer<typeof schema>;
export const loadConfig = (): AppConfig => schema.parse(process.env);
