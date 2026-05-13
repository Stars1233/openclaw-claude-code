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

  it('save merges instead of overwriting — preserves other-owner entries', () => {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    const otherOwner = process.pid + 999999; // synthesised "other manager" pid
    fs.writeFileSync(
      PID_FILE,
      JSON.stringify({
        'their-session': {
          pid: process.pid + 12345,
          ownerPid: otherOwner,
          since: '2026-05-13T00:00:00Z',
        },
      }),
    );
    const mgr = new SessionManager();
    // Triggering a save should preserve the other-owner entry. Force a save
    // by reading the file and re-saving (no public hook; use the internal).
    (mgr as unknown as { _savePids: () => void })._savePids();
    const after = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    expect(after['their-session']).toBeDefined();
    expect(after['their-session'].ownerPid).toBe(otherOwner);
  });
});
