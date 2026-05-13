import { describe, it, expect, vi } from 'vitest';
import { runFixOnFailure } from '../../ultraapp/fix-on-failure.js';

function shellOk() {
  return vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' });
}
function shellRedOnce(then: () => Promise<{ ok: boolean; stdout: string; stderr: string }>) {
  let called = 0;
  return vi.fn().mockImplementation(async () => {
    called++;
    if (called === 1) return { ok: false, stdout: '', stderr: 'TS2304: Cannot find name foo' };
    return then();
  });
}

describe('runFixOnFailure', () => {
  it('returns ok=true when pipeline is green from start', async () => {
    const r = await runFixOnFailure({
      worktreePath: '/tmp/wt',
      maxRounds: 3,
      shell: shellOk(),
      spawnFixer: vi.fn(),
    });
    expect(r.ok).toBe(true);
    expect(r.rounds).toBe(0);
  });

  it('asks the fixer once on red, retries, returns ok when green', async () => {
    const fixer = vi.fn().mockResolvedValue(undefined);
    const shell = shellRedOnce(async () => ({ ok: true, stdout: '', stderr: '' }));
    const r = await runFixOnFailure({
      worktreePath: '/tmp/wt',
      maxRounds: 3,
      shell,
      spawnFixer: fixer,
    });
    expect(r.ok).toBe(true);
    expect(r.rounds).toBe(1);
    expect(fixer).toHaveBeenCalledTimes(1);
  });

  it('exhausts budget when fixer cannot fix', async () => {
    const fixer = vi.fn().mockResolvedValue(undefined);
    const shell = vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'persistent error' });
    const r = await runFixOnFailure({
      worktreePath: '/tmp/wt',
      maxRounds: 2,
      shell,
      spawnFixer: fixer,
    });
    expect(r.ok).toBe(false);
    expect(r.rounds).toBe(2);
    expect(r.lastError).toMatch(/persistent error/);
    expect(fixer).toHaveBeenCalledTimes(2);
  });

  it('passes the failing command + tail of output to the fixer', async () => {
    const fixer = vi.fn().mockResolvedValue(undefined);
    const shell = shellRedOnce(async () => ({ ok: true, stdout: '', stderr: '' }));
    await runFixOnFailure({ worktreePath: '/tmp/wt', maxRounds: 3, shell, spawnFixer: fixer });
    const promptArg = fixer.mock.calls[0][0];
    expect(promptArg.worktreePath).toBe('/tmp/wt');
    expect(promptArg.failingCommand).toBeDefined();
    expect(promptArg.tail).toMatch(/TS2304/);
  });
});
