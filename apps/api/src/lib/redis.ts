export interface RedisLike {
  ping(): Promise<string>;
  info(section?: string): Promise<string>;
  exists(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
  zAdd(key: string, members: { score: number; value: string }): Promise<number>;
  zRemRangeByScore(key: string, min: number, max: number): Promise<number>;
  zCard(key: string): Promise<number>;
}
