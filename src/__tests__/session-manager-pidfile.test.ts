/**
 * Cross-process PID file safety tests.
 *
 * The PID file at ~/.openclaw/session-pids.json is shared between any
 * SessionManager instances running on the host (gateway plugin, standalone
 * serve, tests, etc.). The previous implementation overwrote the file on
 * save and treated every live coding CLI as an orphan on construction —
 * which would kill another live manager's children. Tests here lock down
 * the fix: entries are tagged with ownerPid; cleanup only touches entries
 * whose owner SessionManager is dead.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionManager } from '../session-manager.js';

const PID_FILE = path.join(os.homedir(), '.openclaw', 'session-pids.json');

describe('SessionManager PID-file cross-process safety', () => {
  let backup: string | null = null;

  beforeEach(() => {
    // Back up any existing pid file so this test doesn't trash the user's state
    try {
      backup = fs.readFileSync(PID_FILE, 'utf8');
    } catch {
      backup = null;
    }
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
  });
  afterEach(() => {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    if (backup !== null) {
      fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
      fs.writeFileSync(PID_FILE, backup);
    }
  });

  it('does NOT kill an entry whose ownerPid points to a live SessionManager (this process)', () => {
    // Simulate: another live SessionManager (us, with our own pid) has spawned
    // a coding CLI child at some pid. Write that into the shared pid file with
    // our process.pid as ownerPid.
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    // Use a pid that is alive (process.pid itself); the cleanup must NOT kill
    // anything in our process — but it shouldn't even reach the kill stage
    // because the owner check passes.
    fs.writeFileSync(
      PID_FILE,
      JSON.stringify({
        'sim-session': {
          pid: process.pid,
          ownerPid: process.pid,
          since: new Date().toISOString(),
        },
      }),
    );
    // Constructing a SessionManager runs _cleanupOrphanedPids. We must not
    // crash and must not signal our own process.
    const mgr = new SessionManager();
    expect(mgr.listSessions().length).toBe(0);
  });

  it('skips entries with legacy bare-number format (no ownerPid info)', () => {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(
      PID_FILE,
      JSON.stringify({
        'legacy-session': 99999, // bare number, no ownerPid → must skip
      }),
    );
    const mgr = new SessionManager();
    // Constructor's _savePids drops the legacy entry on read-merge-write.
    // After construction, the file should no longer contain it.
    const after = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    expect(after['legacy-session']).toBeUndefined();
    expect(mgr.listSessions().length).toBe(0);
  });

  it('save merges instead of overwriting — preserves entries whose owner is still alive', () => {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    // Use this process's parent (the vitest worker / npm runner) as the
    // "other live manager" — it's guaranteed alive during the test, and
    // process.pid !== process.ppid so the code path that handles
    // other-owner entries is exercised.
    const liveOtherOwner = process.ppid;
    expect(liveOtherOwner).not.toBe(process.pid);
    fs.writeFileSync(
      PID_FILE,
      JSON.stringify({
        'their-session': {
          pid: process.pid + 12345,
          ownerPid: liveOtherOwner,
          since: '2026-05-13T00:00:00Z',
        },
      }),
    );
    const mgr = new SessionManager();
    // Triggering a save should preserve the live-other-owner entry. Force a
    // save by reading the file and re-saving (no public hook; use internal).
    (mgr as unknown as { _savePids: () => void })._savePids();
    const after = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    expect(after['their-session']).toBeDefined();
    expect(after['their-session'].ownerPid).toBe(liveOtherOwner);
  });

  it('drops entries whose ownerPid is no longer alive (stale-bookkeeping cleanup)', () => {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    // A previously-active SessionManager whose process has since exited.
    // We pick a high pid that almost certainly isn't allocated; the test
    // sanity-checks liveness first to avoid relying on chance.
    let deadOwner = 999999;
    let alive = true;
    while (alive && deadOwner < 1000050) {
      try {
        process.kill(deadOwner, 0);
        deadOwner += 1;
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);

    fs.writeFileSync(
      PID_FILE,
      JSON.stringify({
        'stale-session': {
          pid: process.pid + 99,
          ownerPid: deadOwner,
          since: '2026-05-13T00:00:00Z',
        },
      }),
    );
    const mgr = new SessionManager();
    // _cleanupOrphanedPids ran in the constructor and called _savePids.
    // The stale entry should be gone from disk now.
    const after = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    expect(after['stale-session']).toBeUndefined();
    expect(mgr.listSessions().length).toBe(0);
  });
});
