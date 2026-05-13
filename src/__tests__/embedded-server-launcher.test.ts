import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as net from 'node:net';
import * as path from 'node:path';
import { SessionManager } from '../session-manager.js';
import { EmbeddedServer } from '../embedded-server.js';

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

describe('token file write-order', () => {
  it('does NOT overwrite ~/.openclaw/server-token when bind fails (EADDRINUSE)', async () => {
    const mgr1 = new SessionManager({});
    // EmbeddedServer treats `0 || DEFAULT_SERVER_PORT` as DEFAULT, not ephemeral,
    // so we explicitly grab a free port to keep this test isolated from any
    // standalone clawo-serve that may be running on the default port.
    const ephemeral = await freePort();
    const s1 = new EmbeddedServer(mgr1, ephemeral);
    const port = await s1.start();
    expect(port).toBeGreaterThan(0);

    const tokenPath = path.join(os.homedir(), '.openclaw', 'server-token');
    const winnerToken = fs.readFileSync(tokenPath, 'utf-8').trim();

    // Second instance forced onto the same port → must hit EADDRINUSE and skip
    // WITHOUT touching the token file the winner wrote.
    const mgr2 = new SessionManager({});
    const s2 = new EmbeddedServer(mgr2, port);
    const port2 = await s2.start();
    expect(port2).toBe(0);

    const afterToken = fs.readFileSync(tokenPath, 'utf-8').trim();
    expect(afterToken).toBe(winnerToken);

    await s1.stop();
    await mgr1.shutdown();
    await mgr2.shutdown();
  });
});
