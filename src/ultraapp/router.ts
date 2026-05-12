/**
 * UltraappRouter — tiny in-process reverse proxy that maps
 *   GET/POST/... /forge/<slug>/* → http://127.0.0.1:<backend-port>/*
 *
 * Default port: 19000. If 19000 is occupied, falls back to the next free
 * port in [19000, 19000 + fallbackPorts]. The slug→port map is persisted
 * synchronously to mapPath so a freshly-constructed router restarts with
 * the same routes after process restart.
 *
 * Backends are detected lazily — proxy errors surface as 502.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface UltraappRouterOptions {
  port: number;
  mapPath: string;
  /** Try up to this many subsequent ports if `port` is taken; default 99. */
  fallbackPorts?: number;
}

export class UltraappRouter {
  private readonly map = new Map<string, number>(); // slug → backend port
  private readonly mapPath: string;
  private readonly basePort: number;
  private readonly fallbackPorts: number;
  private server: http.Server | null = null;
  private actualPort: number = 0;

  constructor(opts: UltraappRouterOptions) {
    this.mapPath = opts.mapPath;
    this.basePort = opts.port;
    this.fallbackPorts = opts.fallbackPorts ?? 99;
    this.loadFromDisk();
  }

  async start(): Promise<number> {
    let lastErr: Error | null = null;
    for (let p = this.basePort; p <= this.basePort + this.fallbackPorts; p++) {
      try {
        await this.listenOn(p);
        this.actualPort = p;
        return p;
      } catch (e) {
        lastErr = e as Error;
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e;
      }
    }
    throw new Error(
      `UltraappRouter: no free port in [${this.basePort}, ${this.basePort + this.fallbackPorts}]: ${lastErr?.message ?? 'unknown'}`,
    );
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => this.server!.close(() => resolve()));
  }

  port(): number {
    return this.actualPort;
  }

  register(slug: string, backendPort: number): void {
    this.map.set(slug, backendPort);
    this.saveToDisk();
  }

  deregister(slug: string): void {
    this.map.delete(slug);
    this.saveToDisk();
  }

  list(): Array<{ slug: string; port: number }> {
    return [...this.map.entries()].map(([slug, port]) => ({ slug, port }));
  }

  private listenOn(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handle(req, res));
      const onError = (err: Error) => {
        srv.removeListener('error', onError);
        reject(err);
      };
      srv.on('error', onError);
      srv.listen(port, '127.0.0.1', () => {
        srv.removeListener('error', onError);
        this.server = srv;
        resolve();
      });
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/';
    const m = /^\/forge\/([a-z0-9-]+)(\/.*)?$/.exec(url);
    if (!m) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const slug = m[1];
    const tail = m[2] ?? '/';
    const backend = this.map.get(slug);
    if (backend === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`forge slug not registered: ${slug}`);
      return;
    }
    const proxy = http.request(
      {
        host: '127.0.0.1',
        port: backend,
        path: tail,
        method: req.method,
        headers: { ...req.headers, 'x-forwarded-prefix': `/forge/${slug}` },
      },
      (br) => {
        res.writeHead(br.statusCode ?? 502, br.headers);
        br.pipe(res);
      },
    );
    proxy.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`proxy error: ${e.message}`);
    });
    req.pipe(proxy);
  }

  private loadFromDisk(): void {
    try {
      const raw = fs.readFileSync(this.mapPath, 'utf8');
      const obj = JSON.parse(raw) as Record<string, number>;
      for (const [slug, port] of Object.entries(obj)) this.map.set(slug, port);
    } catch {
      /* no map yet */
    }
  }

  private saveToDisk(): void {
    const obj: Record<string, number> = {};
    for (const [slug, port] of this.map) obj[slug] = port;
    try {
      fs.mkdirSync(path.dirname(this.mapPath), { recursive: true });
      fs.writeFileSync(this.mapPath, JSON.stringify(obj, null, 2));
    } catch {
      /* best effort — non-persistent operation is still fine for current process */
    }
  }
}
