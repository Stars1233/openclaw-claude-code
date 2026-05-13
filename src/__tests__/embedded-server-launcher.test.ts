import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionManager } from '../session-manager.js';
import { EmbeddedServer } from '../embedded-server.js';

describe('token file write-order', () => {
  it('does NOT overwrite ~/.openclaw/server-token when bind fails (EADDRINUSE)', async () => {
    const mgr1 = new SessionManager({});
    const s1 = new EmbeddedServer(mgr1, 0);
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
