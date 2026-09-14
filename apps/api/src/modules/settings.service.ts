import type { PrismaClient } from '@prisma/client';
import { decrypt, encrypt } from '../lib/crypto.js';
import type { AppConfig } from '../config.js';
import { defaultPasswordPolicy, type PasswordPolicy } from '../lib/password.js';

export const publicDefaults: Record<string, unknown> = {
  'site.name': 'XLive', 'site.subtitle': '看见每一种热爱', 'site.description': '轻量、开放的多用户直播平台',
  'site.keywords': '直播,视频,互动', 'site.logo': '', 'site.darkLogo': '', 'site.favicon': '',
  'site.footer': '让连接实时发生', 'site.copyright': '© 2026 XLive', 'site.icp.text': '', 'site.icp.url': '',
  'site.userAgreement': `欢迎使用 XLive 直播平台！

一、服务说明
XLive 是一个多用户直播与互动平台。您在注册和使用本平台前，请仔细阅读本协议的全部内容。注册成功即视为您已充分理解并同意本协议。

二、账号注册
1. 您需年满 18 周岁，或已获得监护人同意方可注册使用本平台。
2. 注册时请提供真实、准确的信息，并妥善保管账号密码，因保管不善造成的损失由您自行承担。
3. 不得恶意批量注册账号。

三、用户行为规范
1. 禁止发布违反法律法规的内容，包括但不限于：危害国家安全、暴力恐怖、色情低俗、赌博诈骗、侵犯他人隐私与知识产权的内容。
2. 禁止在直播、弹幕与聊天中辱骂、骚扰或人身攻击其他用户。
3. 禁止利用平台漏洞进行攻击、盗取数据、刷量作弊等行为。

四、内容与知识产权
您发布的直播与内容，授权平台在提供服务所需的范围内存储、分发与展示。您保证所发布内容不侵犯任何第三方合法权益。

五、隐私保护
平台将按照相关法律法规保护您的个人信息，未经您同意不向第三方披露，法律法规另有规定的除外。

六、责任与免责
1. 因您的行为导致的后果由您自行承担。
2. 平台有权对违规账号采取警告、禁言、封禁等措施，并配合有关部门调查。
3. 因不可抗力、网络故障等导致服务中断的，平台不承担责任。

七、协议变更
平台有权更新本协议，更新后将公布最新版本，继续使用平台即视为接受新协议。

如有疑问，请联系平台管理员。`,
  'site.police.text': '', 'site.police.url': '', 'auth.guestViewing': true,
  'auth.register.email': true, 'auth.register.sms': false, 'auth.register.rule': 'ANY', 'auth.register.requireVerification': false,
  'password.policy': defaultPasswordPolicy,
  'live.allowRegisteredUsers': true, 'live.newUserCanStream': false, 'live.maxConcurrent': 100,
  'live.maxPerUser': 1, 'live.maxBitrateKbps': 8000, 'live.maxFps': 60, 'live.codecs': ['H264', 'AAC'], 'live.showPlayerLatency': false,
  'live.playback.protocol': 'FLV', 'live.playback.flvHost': '',
  'live.transcode.qualities': [
    { label: '2.5K', width: 2560, height: 1440, bitrate: 5000, fps: 30, enabled: true },
    { label: '4K', width: 3840, height: 2160, bitrate: 8000, fps: 30, enabled: true },
    { label: '1080P', width: 1920, height: 1080, bitrate: 3000, fps: 30, enabled: true },
    { label: '720P', width: 1280, height: 720, bitrate: 1500, fps: 30, enabled: true },
    { label: '480P', width: 854, height: 480, bitrate: 800, fps: 25, enabled: true }
  ],
  'security.loginMaxFailures': 5, 'security.loginLockMinutes': 15
};

export class SettingsService {
  private cache = new Map<string, unknown>();
  private loadedAt = 0;
  constructor(private db: PrismaClient, private config: AppConfig) {}

  async all(includeSensitive = false) {
    const rows = await this.db.systemSetting.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
    const merged = new Map(Object.entries(publicDefaults));
    for (const row of rows) {
      if (row.sensitive && !includeSensitive) { merged.set(row.key, row.value ? '********' : ''); continue; }
      const raw = row.sensitive && row.value ? decrypt(row.value, this.config.CONFIG_ENCRYPTION_KEY) : row.value;
      try { merged.set(row.key, JSON.parse(raw)); } catch { merged.set(row.key, raw); }
    }
    return Object.fromEntries(merged);
  }

  async publicSettings() {
    const all = await this.all(false);
    return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith('site.') || ['auth.guestViewing', 'auth.register.email', 'auth.register.sms', 'auth.register.rule', 'password.policy', 'live.showPlayerLatency'].includes(key)));
  }

  async get<T>(key: string, fallback?: T): Promise<T> {
    if (Date.now() - this.loadedAt > 30_000) { this.cache.clear(); this.loadedAt = Date.now(); }
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const row = await this.db.systemSetting.findUnique({ where: { key } });
    let value: unknown = publicDefaults[key] ?? fallback;
    if (row) {
      const raw = row.sensitive && row.value ? decrypt(row.value, this.config.CONFIG_ENCRYPTION_KEY) : row.value;
      try { value = JSON.parse(raw); } catch { value = raw; }
    }
    this.cache.set(key, value); return value as T;
  }

  passwordPolicy() { return this.get<PasswordPolicy>('password.policy', defaultPasswordPolicy); }

  async setMany(values: Record<string, unknown>, updatedBy: string, sensitiveKeys: string[] = []) {
    for (const [key, value] of Object.entries(values)) {
      const sensitive = sensitiveKeys.includes(key) || ['smtp.password', 'sms.accessKeySecret'].includes(key);
      if (sensitive && (value === '' || value === '********')) continue;
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      await this.db.systemSetting.upsert({ where: { key }, update: { value: sensitive ? encrypt(raw, this.config.CONFIG_ENCRYPTION_KEY) : raw, sensitive, updatedBy }, create: { key, value: sensitive ? encrypt(raw, this.config.CONFIG_ENCRYPTION_KEY) : raw, group: key.split('.')[0]!, sensitive, updatedBy } });
    }
    this.cache.clear();
  }
}
