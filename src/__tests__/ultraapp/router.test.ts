import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UltraappRouter } from '../../ultraapp/router.js';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function startBackend(port: number, body: string): Promise<http.Server> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${body}|path=${req.url}`);
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

function get(port: number, p: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });
}

describe('UltraappRouter', () => {
  let mapDir: string;
  let mapPath: string;
  let router: UltraappRouter;
  let backend: http.Server;
  let routerPort: number;
  let backendPort: number;

  beforeEach(async () => {
    routerPort = await freePort();
    backendPort = await freePort();
    mapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-router-'));
    mapPath = path.join(mapDir, 'map.json');
    router = new UltraappRouter({ port: routerPort, mapPath, fallbackPorts: 10 });
    await router.start();
    backend = await startBackend(backendPort, 'backend-A');
  });
  afterEach(async () => {
    await router.stop();
    await new Promise<void>((r) => backend.close(() => r()));
    fs.rmSync(mapDir, { recursive: true, force: true });
  });

  it('proxies /forge/<slug>/* to the registered backend with the full URL preserved', async () => {
    // The router does NOT strip the /forge/<slug> prefix — apps mount at
    // BASE_PATH internally (Hono basePath / Next.js basePath) and expect
    // the full URL.
    router.register('foo', backendPort);
    const r = await get(routerPort, '/forge/foo/bar');
    expect(r.status).toBe(200);
    expect(r.body).toContain('backend-A');
    expect(r.body).toContain('path=/forge/foo/bar');
  });

  it('returns 404 for /forge/<slug>/ when slug is unregistered', async () => {
    const r = await get(routerPort, '/forge/missing/');
    expect(r.status).toBe(404);
  });

  it('returns 404 for non-/forge paths', async () => {
    const r = await get(routerPort, '/');
    expect(r.status).toBe(404);
  });

  it('persists registrations to the map file synchronously', async () => {
    router.register('bar', backendPort);
    const onDisk = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as Record<string, number>;
    expect(onDisk.bar).toBe(backendPort);
  });

  it('reloads registrations from disk on construction', async () => {
    router.register('saved', backendPort);
    await router.stop();
    const port2 = await freePort();
    const router2 = new UltraappRouter({ port: port2, mapPath });
    await router2.start();
    try {
      const r = await get(port2, '/forge/saved/');
      expect(r.status).toBe(200);
      expect(r.body).toContain('backend-A');
    } finally {
      await router2.stop();
    }
  });

  it('deregister removes the route', async () => {
    router.register('temp', backendPort);
    router.deregister('temp');
    const r = await get(routerPort, '/forge/temp/');
    expect(r.status).toBe(404);
  });

  it('list() returns current registrations', () => {
    router.register('a', backendPort);
    router.register('b', backendPort + 1);
    const l = router.list();
    expect(l.length).toBe(2);
    expect(l.find((x) => x.slug === 'a')!.port).toBe(backendPort);
  });

  it('falls back to next free port when basePort taken', async () => {
    const blocker = http.createServer().listen(0, '127.0.0.1');
    await new Promise<void>((r) => blocker.on('listening', () => r()));
    const blockedPort = (blocker.address() as net.AddressInfo).port;
    const r = new UltraappRouter({ port: blockedPort, mapPath, fallbackPorts: 5 });
    try {
      const actual = await r.start();
      expect(actual).toBeGreaterThan(blockedPort);
      expect(r.port()).toBe(actual);
    } finally {
      await r.stop();
      await new Promise<void>((res) => blocker.close(() => res()));
    }
  });
});
