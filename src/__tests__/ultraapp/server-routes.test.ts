import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import { EmbeddedServer } from '../../embedded-server.js';
import type { SessionManager } from '../../session-manager.js';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

function request(
  port: number,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(opts.headers ?? {}),
          ...(data ? { 'Content-Length': String(Buffer.byteLength(data)) } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function fakeManager() {
  const emitter = new EventEmitter();
  return {
    getVersion: vi.fn().mockReturnValue('test'),
    listSessions: vi.fn().mockReturnValue([]),
    getUltraappManager: vi.fn().mockReturnValue({
      createRun: vi.fn().mockResolvedValue('ua-test-1'),
      submitAnswer: vi.fn().mockResolvedValue(undefined),
      applySpecEdit: vi.fn().mockResolvedValue(undefined),
      addFile: vi.fn().mockResolvedValue({ ref: '/tmp/foo' }),
      subscribe: vi.fn().mockImplementation((_id: string, listener: (ev: unknown) => void) => {
        emitter.on('event', listener);
        return () => emitter.off('event', listener);
      }),
      store: {
        listRuns: vi.fn().mockResolvedValue([
          {
            runId: 'ua-test-1',
            mode: 'interview',
            title: 'Demo',
            createdAt: '2026-05-11T00:00:00Z',
            updatedAt: '2026-05-11T00:00:00Z',
          },
        ]),
        readSpec: vi.fn().mockResolvedValue({ meta: { name: 'demo' } }),
        readChat: vi.fn().mockResolvedValue([]),
        readState: vi.fn().mockResolvedValue({ runId: 'ua-test-1', mode: 'interview' }),
      },
    }),
  };
}

describe('ultraapp routes', () => {
  let srv: EmbeddedServer;
  let port: number;

  beforeEach(async () => {
    process.env.OPENCLAW_SERVER_TOKEN = 'disabled';
    port = await getFreePort();
    srv = new EmbeddedServer(fakeManager() as unknown as SessionManager, port, '127.0.0.1');
    await srv.start();
  });
  afterEach(async () => {
    await srv.stop();
    delete process.env.OPENCLAW_SERVER_TOKEN;
  });

  it('POST /ultraapp/new returns runId', async () => {
    const r = await request(port, '/ultraapp/new', { body: {} });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).runId).toBe('ua-test-1');
  });

  it('POST /ultraapp/list returns runs', async () => {
    const r = await request(port, '/ultraapp/list', { body: {} });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).runs[0].runId).toBe('ua-test-1');
  });

  it('POST /ultraapp/<id>/answer accepts an answer', async () => {
    const r = await request(port, '/ultraapp/ua-test-1/answer', { body: { value: 'a' } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
  });

  it('POST /ultraapp/<id>/spec-edit accepts a JSON patch', async () => {
    const r = await request(port, '/ultraapp/ua-test-1/spec-edit', {
      body: { patch: [{ op: 'replace', path: '/meta/name', value: 'x' }] },
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
  });

  it('POST /ultraapp/<id> returns spec + chat + state', async () => {
    const r = await request(port, '/ultraapp/ua-test-1', { body: {} });
    expect(r.status).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.spec.meta.name).toBe('demo');
    expect(j.state.mode).toBe('interview');
  });
});
