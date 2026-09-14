import { spawn, type ChildProcess } from 'node:child_process';
import type { SettingsService } from './settings.service.js';

export type QualitySetting = { label: string; width: number; height: number; bitrate: number; fps: number; enabled?: boolean };
export const qualitySlug = (label: string) => label.replace(/[^A-Za-z0-9]/g, '');

export class TranscoderService {
  private procs = new Map<string, ChildProcess[]>();
  private probes = new Map<string, { width: number; height: number }>();
  constructor(private settings: SettingsService) {}

  probeOf(stream: string) { return this.probes.get(stream); }

  async onPublish(stream: string) {
    this.onUnpublish(stream);
    const qualities = (await this.settings.get<QualitySetting[]>('live.transcode.qualities', [])).filter(q => q.enabled !== false && q.width > 0 && q.height > 0 && q.bitrate > 0 && q.fps > 0);
    if (!qualities.length) return;
    const src = await this.probe(stream);
    if (!src) return;
    const targets = qualities.filter(q => q.width < src.width && q.height < src.height);
    if (!targets.length) return;
    const procs = targets.map(q => {
      const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', `rtmp://srs:1935/live/${stream}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', `${q.bitrate}k`, '-maxrate', `${Math.round(q.bitrate * 1.2)}k`, '-bufsize', `${q.bitrate * 2}k`, '-vf', `scale=${q.width}:${q.height}`, '-r', String(q.fps), '-g', String(q.fps * 2), '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'flv', `rtmp://srs2:1936/live/${stream}_${qualitySlug(q.label)}`], { stdio: 'ignore' });
      proc.on('error', () => {}); proc.on('exit', () => { this.procs.set(stream, (this.procs.get(stream) ?? []).filter(p => p !== proc)); });
      return proc;
    });
    this.procs.set(stream, procs);
  }

  onUnpublish(stream: string) {
    const procs = this.procs.get(stream) ?? []; this.procs.delete(stream);
    for (const proc of procs) proc.kill('SIGKILL');
  }

  private probe(stream: string): Promise<{ width: number; height: number } | null> {
    return new Promise(resolve => {
      const proc = spawn('ffprobe', ['-v', 'error', '-analyzeduration', '3M', '-probesize', '3M', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', `rtmp://srs:1935/live/${stream}`], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = ''; const timer = setTimeout(() => proc.kill('SIGKILL'), 10_000);
      proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      proc.on('error', () => { clearTimeout(timer); resolve(null); });
      proc.on('exit', () => {
        clearTimeout(timer);
        const match = /(\d+),(\d+)/.exec(out);
        const info = match ? { width: Number(match[1]), height: Number(match[2]) } : null;
        if (info) this.probes.set(stream, info);
        resolve(info);
      });
    });
  }
}
