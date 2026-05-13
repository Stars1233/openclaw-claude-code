import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as net from 'node:net';
import * as path from 'node:path';
import { SessionManager } from '../session-manager.js';
import { EmbeddedServer } from '../embedded-server.js';
import type { CouncilSession } from '../types.js';

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

describe('POST /council/new', () => {
  let manager: SessionManager;
  let server: EmbeddedServer;
  let port: number;
  let token: string;

  beforeAll(async () => {
    manager = new SessionManager({});
    // councilStart spawns real Claude subprocesses — stub it for the unit test.
    vi.spyOn(manager, 'councilStart').mockImplementation(
      (task: string): CouncilSession => ({
        id: 'fake-council-id-001',
        task,
        status: 'running',
        startTime: '2026-05-13T05:00:00.000Z',
        responses: [],
        config: { agents: [], maxRounds: 0, projectDir: '/tmp' },
      }),
    );
    const ephemeral = await freePort();
    server = new EmbeddedServer(manager, ephemeral);
    port = await server.start();
    token = fs.readFileSync(path.join(os.homedir(), '.openclaw', 'server-token'), 'utf-8').trim();
  });
  afterAll(async () => {
    await server.stop();
    await manager.shutdown();
  });

  it('starts a council and returns its id', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/council/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ task: 'test task', projectDir: '/tmp' }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; id: string; status: string };
    expect(j.ok).toBe(true);
    expect(j.id).toBe('fake-council-id-001');
    expect(j.status).toBe('running');
    expect(manager.councilStart).toHaveBeenCalledOnce();
  });

  it('returns 400 when task is missing', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/council/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectDir: '/tmp' }),
    });
    expect(r.status).toBe(400);
  });

  it('returns 400 when projectDir is missing', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/council/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ task: 'just a task' }),
    });
    expect(r.status).toBe(400);
  });
});

describe('POST /autoloop/new', () => {
  let manager: SessionManager;
  let server: EmbeddedServer;
  let port: number;
  let token: string;

  beforeAll(async () => {
    manager = new SessionManager({});
    // autoloopStart kicks off Claude subprocesses — stub for unit tests.
    vi.spyOn(manager, 'autoloopStart').mockImplementation(async (opts) => ({
      runId: opts.runId,
      plannerSession: `planner-${opts.runId}`,
      state: {
        run_id: opts.runId,
        status: 'planning',
        iter: 0,
        subagents_spawned: false,
        started_at: '2026-05-13T05:00:00.000Z',
        workspace: opts.workspace,
        ledger_dir: path.join(opts.workspace, 'tasks', opts.runId),
        push_log_count: 0,
        status_reason: null,
        consecutive_phase_errors: 0,
        recent_phase_errors: [],
        metric_history: [],
        last_activity_at: 0,
      },
    }));
    const ephemeral = await freePort();
    server = new EmbeddedServer(manager, ephemeral);
    port = await server.start();
    token = fs.readFileSync(path.join(os.homedir(), '.openclaw', 'server-token'), 'utf-8').trim();
  });
  afterAll(async () => {
    await server.stop();
    await manager.shutdown();
  });

  it('starts an autoloop and returns a server-generated run_id', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/autoloop/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspace: '/tmp' }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; run_id: string };
    expect(j.ok).toBe(true);
    expect(j.run_id).toMatch(/^auto-\d+-[a-f0-9]+$/);
  });

  it('honors an explicit well-shaped run_id', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/autoloop/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspace: '/tmp', run_id: 'my-custom-id' }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { run_id: string };
    expect(j.run_id).toBe('my-custom-id');
  });

  it('rejects a malformed run_id (server-generates instead)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/autoloop/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspace: '/tmp', run_id: 'has spaces and !@#$' }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { run_id: string };
    expect(j.run_id).toMatch(/^auto-\d+-[a-f0-9]+$/);
  });

  it('returns 400 when workspace is missing', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/autoloop/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}',
    });
    expect(r.status).toBe(400);
  });
});
