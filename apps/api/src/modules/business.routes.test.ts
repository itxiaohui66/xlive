import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../lib/password.js';
import { authRoutes } from './auth.routes.js';
import { roomRoutes } from './rooms.routes.js';
import { SettingsService } from './settings.service.js';

const config={JWT_SECRET:'test-secret-test-secret-test-secret-123',COOKIE_SECURE:false,CONFIG_ENCRYPTION_KEY:'settings-test-key',RTMP_PUBLIC_URL:'rtmp://localhost/live',HLS_PUBLIC_URL:'http://localhost/live',SRS_API_URL:'http://srs:1985'} as never;
const user=(passwordHash:string)=>({id:'1d3ba0bb-5560-4184-9267-4a7ad9012a50',username:'alice',nickname:'Alice',avatar:null,email:'alice@example.com',phone:null,status:'ACTIVE',canStream:true,createdAt:new Date(),failedLoginCount:0,lockedUntil:null,passwordHash,roles:[{role:{name:'USER'}}]});

describe('authentication routes',()=>{
  it('registers a valid user',async()=>{const created=user('hash');const db={user:{findFirst:vi.fn().mockResolvedValue(null),create:vi.fn().mockResolvedValue(created)}} as never;const settings={all:vi.fn().mockResolvedValue({'auth.register.email':true,'auth.register.sms':false,'auth.register.requireVerification':false}),passwordPolicy:vi.fn().mockResolvedValue({minLength:8,maxLength:64,uppercase:true,lowercase:true,number:true,special:false}),get:vi.fn().mockResolvedValue(true)} as never;const app=Fastify();await app.register(cookie);await app.register(jwt,{secret:(config as any).JWT_SECRET,cookie:{cookieName:'xlive_access',signed:false}});await authRoutes(app,{db,config,settings,verification:{} as never});const r=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'alice',nickname:'Alice',email:'alice@example.com',password:'ValidPass123'}});expect(r.statusCode).toBe(201);expect((db as any).user.create).toHaveBeenCalled()});
  it('logs in and issues HttpOnly cookies',async()=>{const u=user(await hashPassword('ValidPass123'));const db={user:{findFirst:vi.fn().mockResolvedValue(u),update:vi.fn().mockResolvedValue(u)},refreshToken:{create:vi.fn().mockResolvedValue({})},loginLog:{create:vi.fn().mockResolvedValue({})},$transaction:vi.fn(async(items:Promise<unknown>[])=>Promise.all(items))} as never;const settings={get:vi.fn()} as never;const app=Fastify();await app.register(cookie);await app.register(jwt,{secret:(config as any).JWT_SECRET,cookie:{cookieName:'xlive_access',signed:false}});await authRoutes(app,{db,config,settings,verification:{} as never});const r=await app.inject({method:'POST',url:'/api/auth/login',payload:{account:'alice',password:'ValidPass123'}});expect(r.statusCode).toBe(200);expect(String(r.headers['set-cookie'])).toContain('HttpOnly')});
});

describe('room discovery',()=>{it('always filters normal listings to public rooms',async()=>{const db={room:{findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(0)},category:{findMany:vi.fn()}} as never;const app=Fastify();await app.register(cookie);await roomRoutes(app,{db,redis:{} as never,config,settings:{} as never});const r=await app.inject({method:'GET',url:'/api/rooms?search=secret'});expect(r.statusCode).toBe(200);expect((db as any).room.findMany.mock.calls[0][0].where.visibility).toBe('PUBLIC')})});

describe('system settings',()=>{it('never returns sensitive plaintext to admin lists',async()=>{const db={systemSetting:{findMany:vi.fn().mockResolvedValue([{key:'smtp.password',value:'encrypted-value',group:'smtp',sensitive:true}])}} as never;const service=new SettingsService(db,config);const all=await service.all(false);expect(all['smtp.password']).toBe('********')})});
