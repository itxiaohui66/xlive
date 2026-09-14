export type ApiError = { code: string; message: string; requestId?: string };
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const requestBody = init.body ?? (init.method === 'POST' ? '{}' : undefined);
  const response = await fetch(path, { ...init, body: requestBody, credentials: 'include', headers: { ...(requestBody !== undefined && !(requestBody instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  if (response.status === 401 && path !== '/api/auth/refresh') { const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }); if (refreshed.ok) return api<T>(path, init); }
  const body = await response.json().catch(() => ({ code: 'NETWORK_ERROR', message: '服务返回了无法解析的响应' }));
  if (!response.ok) throw body as ApiError; return body as T;
}
