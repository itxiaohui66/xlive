import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.restoreAllMocks());

describe('API client', () => {
  it('returns typed JSON data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(api<{ data: { ok: boolean } }>('/api/test')).resolves.toEqual({ data: { ok: true } });
  });

  it('surfaces safe API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'ROOM_NOT_FOUND', message: '直播间不存在' }), { status: 404, headers: { 'content-type': 'application/json' } })));
    await expect(api('/api/rooms/0')).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
  });

  it('does not send a JSON content type with an empty DELETE body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { deleted: true } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/api/test', { method: 'DELETE' });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: undefined, headers: {} });
  });
});
