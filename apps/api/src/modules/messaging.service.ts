import nodemailer from 'nodemailer';
import type { CodePurpose } from '@prisma/client';
import type { SettingsService } from './settings.service.js';
import { AppError } from '../lib/errors.js';
import { hmacSha1Base64 } from '../lib/crypto.js';

type SmtpConfig = { host: string; port: number; username: string; password: string; encryption: 'NONE' | 'SSL' | 'STARTTLS'; fromEmail: string; fromName: string };
type SmsConfig = { accessKeyId: string; accessKeySecret: string; signName: string; regionId?: string; registerTemplateId: string; loginTemplateId: string; resetTemplateId: string };

export class MessagingService {
  constructor(private settings: SettingsService) {}

  private async smtp(): Promise<SmtpConfig> {
    const all = await this.settings.all(true);
    const c = {
      host: String(all['smtp.host'] ?? ''), port: Number(all['smtp.port'] ?? 587), username: String(all['smtp.username'] ?? ''),
      password: String(all['smtp.password'] ?? ''), encryption: String(all['smtp.encryption'] ?? 'STARTTLS') as SmtpConfig['encryption'],
      fromEmail: String(all['smtp.fromEmail'] ?? ''), fromName: String(all['smtp.fromName'] ?? all['site.name'] ?? 'XLive')
    };
    if (!c.host || !c.fromEmail) throw new AppError('SMTP_NOT_CONFIGURED', 'SMTP 尚未配置');
    return c;
  }

  async sendEmail(to: string, subject: string, text: string) {
    const c = await this.smtp();
    const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.encryption === 'SSL', requireTLS: c.encryption === 'STARTTLS', auth: c.username ? { user: c.username, pass: c.password } : undefined, connectionTimeout: 10_000 });
    try {
      await transport.verify();
      return await transport.sendMail({ from: { address: c.fromEmail, name: c.fromName }, to, subject, text });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      throw new AppError('SMTP_SEND_FAILED', `邮件发送失败：${message}`, 502);
    }
  }

  async sendSms(phone: string, templateId: string, code: string) {
    const all = await this.settings.all(true);
    const c: SmsConfig = { accessKeyId: String(all['sms.accessKeyId'] ?? ''), accessKeySecret: String(all['sms.accessKeySecret'] ?? ''), signName: String(all['sms.signName'] ?? ''), regionId: String(all['sms.regionId'] ?? 'cn-hangzhou'), registerTemplateId: String(all['sms.registerTemplateId'] ?? ''), loginTemplateId: String(all['sms.loginTemplateId'] ?? ''), resetTemplateId: String(all['sms.resetTemplateId'] ?? '') };
    if (!c.accessKeyId || !c.accessKeySecret || !c.signName || !templateId) throw new AppError('SMS_NOT_CONFIGURED', '阿里云短信尚未完整配置');
    const params: Record<string, string> = {
      AccessKeyId: c.accessKeyId, Action: 'SendSms', Format: 'JSON', PhoneNumbers: phone, RegionId: c.regionId ?? 'cn-hangzhou',
      SignName: c.signName, SignatureMethod: 'HMAC-SHA1', SignatureNonce: crypto.randomUUID(), SignatureVersion: '1.0',
      TemplateCode: templateId, TemplateParam: JSON.stringify({ code }), Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), Version: '2017-05-25'
    };
    const percent = (s: string) => encodeURIComponent(s).replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
    const canonical = Object.keys(params).sort().map(k => `${percent(k)}=${percent(params[k]!)}`).join('&');
    params.Signature = hmacSha1Base64(`${c.accessKeySecret}&`, `GET&%2F&${percent(canonical)}`);
    const response = await fetch(`https://dysmsapi.aliyuncs.com/?${new URLSearchParams(params)}`);
    const body = await response.json() as { Code?: string; Message?: string; RequestId?: string };
    if (!response.ok || body.Code !== 'OK') throw new AppError('SMS_SEND_FAILED', `短信发送失败：${body.Message ?? body.Code ?? response.statusText}`, 502);
    return body;
  }

  async sendSmsForPurpose(phone: string, purpose: CodePurpose, code: string) {
    const key = purpose === 'REGISTER' ? 'sms.registerTemplateId' : purpose === 'LOGIN' ? 'sms.loginTemplateId' : 'sms.resetTemplateId';
    return this.sendSms(phone, await this.settings.get<string>(key, ''), code);
  }
}
