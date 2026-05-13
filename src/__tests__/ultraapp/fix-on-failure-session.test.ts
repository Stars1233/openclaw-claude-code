import { describe, it, expect, vi } from 'vitest';
import { spawnFixerSessionWith } from '../../ultraapp/fix-on-failure-session.js';

describe('spawnFixerSessionWith', () => {
  it('starts a Claude Opus session, sends a fix prompt, waits for completion, stops the session', async () => {
    const sm = {
      startSession: vi.fn().mockResolvedValue({ name: 'fixer-1' }),
      sendMessage: vi.fn().mockResolvedValue({ output: 'Fixed.\n[FIX-ROUND-DONE]' }),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };
    await spawnFixerSessionWith(sm, {
      worktreePath: '/tmp/wt',
      failingCommand: 'npm test',
      tail: 'TS2304: Cannot find name foo',
    });
    expect(sm.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/wt',
        model: 'claude-opus-4-7',
      }),
    );
    const sessionName = sm.startSession.mock.calls[0][0].name;
    expect(sm.sendMessage).toHaveBeenCalledWith(sessionName, expect.stringMatching(/npm test/));
    expect(sm.stopSession).toHaveBeenCalledWith(sessionName);
  });

  it('keeps prompting up to 5 attempts when fixer never says done', async () => {
    const sm = {
      startSession: vi.fn().mockResolvedValue({ name: 'fixer-x' }),
      sendMessage: vi.fn().mockResolvedValue({ output: 'still working...' }),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };
    await spawnFixerSessionWith(sm, {
      worktreePath: '/tmp/wt',
      failingCommand: 'npm test',
      tail: 'oops',
    });
    expect(sm.sendMessage).toHaveBeenCalledTimes(5);
    expect(sm.stopSession).toHaveBeenCalledTimes(1);
  });

  it('always stops the session even if sendMessage throws', async () => {
    const sm = {
      startSession: vi.fn().mockResolvedValue({ name: 'fixer-2' }),
      sendMessage: vi.fn().mockRejectedValue(new Error('boom')),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      spawnFixerSessionWith(sm, {
        worktreePath: '/tmp/wt',
        failingCommand: 'npm test',
        tail: 'tail',
      }),
    ).rejects.toThrow(/boom/);
    expect(sm.stopSession).toHaveBeenCalledTimes(1);
  });
});
