import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runPatcher } from '../../ultraapp/patcher.js';

describe('runPatcher', () => {
  let wt: string;
  beforeEach(() => {
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-patcher-'));
    fs.writeFileSync(path.join(wt, 'app.css'), '.btn { color: blue; }\n');
  });
  afterEach(() => fs.rmSync(wt, { recursive: true, force: true }));

  it('happy path: LLM returns diff, validate passes, returns ok', async () => {
    const llmCall = vi.fn().mockResolvedValue({
      output:
        '```diff\n--- a/app.css\n+++ b/app.css\n@@ -1,1 +1,1 @@\n-.btn { color: blue; }\n+.btn { color: green; }\n```',
    });
    const validate = vi.fn().mockResolvedValue({ ok: true, rounds: 0 });
    const r = await runPatcher({
      worktreePath: wt,
      feedback: 'make button green',
      llmCall,
      validate,
    });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(wt, 'app.css'), 'utf8')).toContain('green');
  });

  it('reverts on validate failure', async () => {
    const original = fs.readFileSync(path.join(wt, 'app.css'), 'utf8');
    const llmCall = vi.fn().mockResolvedValue({
      output:
        '```diff\n--- a/app.css\n+++ b/app.css\n@@ -1,1 +1,1 @@\n-.btn { color: blue; }\n+.btn { color: BROKEN; }\n```',
    });
    const validate = vi.fn().mockResolvedValue({ ok: false, reason: 'tests failed', rounds: 5 });
    const r = await runPatcher({
      worktreePath: wt,
      feedback: 'something',
      llmCall,
      validate,
    });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(path.join(wt, 'app.css'), 'utf8')).toBe(original);
  });

  it('fails when diff cannot apply (conflict)', async () => {
    const llmCall = vi.fn().mockResolvedValue({
      output: '```diff\n--- a/app.css\n+++ b/app.css\n@@ -1,1 +1,1 @@\n-NOT THE FILE CONTENT\n+something\n```',
    });
    const validate = vi.fn();
    const r = await runPatcher({
      worktreePath: wt,
      feedback: 'x',
      llmCall,
      validate,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/conflict|apply/i);
    expect(validate).not.toHaveBeenCalled();
  });

  it('refuses when LLM declares OUT OF SCOPE', async () => {
    const llmCall = vi.fn().mockResolvedValue({
      output: '[OUT OF SCOPE: spec change required]',
    });
    const validate = vi.fn();
    const r = await runPatcher({
      worktreePath: wt,
      feedback: 'add a new pipeline step',
      llmCall,
      validate,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/spec change/i);
    expect(validate).not.toHaveBeenCalled();
  });

  it('fails when LLM does not return a diff block', async () => {
    const llmCall = vi.fn().mockResolvedValue({ output: 'sure, here is some text' });
    const validate = vi.fn();
    const r = await runPatcher({
      worktreePath: wt,
      feedback: 'x',
      llmCall,
      validate,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/diff/);
  });

  it('reverts new files created by the diff on validate failure', async () => {
    const llmCall = vi.fn().mockResolvedValue({
      output: '```diff\n--- /dev/null\n+++ b/extra.txt\n@@ -0,0 +1,1 @@\n+new file\n```',
    });
    const validate = vi.fn().mockResolvedValue({ ok: false, reason: 'fail', rounds: 1 });
    await runPatcher({
      worktreePath: wt,
      feedback: 'x',
      llmCall,
      validate,
    });
    expect(fs.existsSync(path.join(wt, 'extra.txt'))).toBe(false);
  });
});
