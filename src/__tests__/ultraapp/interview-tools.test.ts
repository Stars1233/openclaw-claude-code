import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runToolCalls } from '../../ultraapp/interview-tools.js';
import { UltraappStore } from '../../ultraapp/store.js';

describe('runToolCalls', () => {
  let tmp: string;
  let store: UltraappStore;
  let runId: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-tools-'));
    store = new UltraappStore(tmp);
    runId = await store.createRun();
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('update_spec applies a JSON patch and persists', async () => {
    const out = await runToolCalls({
      runId,
      store,
      extractMetadata: vi.fn(),
      calls: [
        {
          name: 'update_spec',
          argsRaw: '[{"op":"replace","path":"/meta/name","value":"demo"}]',
        },
      ],
    });
    expect(out[0].ok).toBe(true);
    const spec = await store.readSpec(runId);
    expect(spec.meta.name).toBe('demo');
  });

  it('update_spec rejects invalid resulting spec', async () => {
    const out = await runToolCalls({
      runId,
      store,
      extractMetadata: vi.fn(),
      calls: [
        {
          name: 'update_spec',
          argsRaw: '[{"op":"replace","path":"/meta/name","value":"BAD NAME"}]',
        },
      ],
    });
    expect(out[0].ok).toBe(false);
    expect(out[0].error).toMatch(/meta\.name/);
  });

  it('extract_metadata calls injected fn with the ref', async () => {
    const fn = vi.fn().mockResolvedValue({ fileType: 'video', sizeBytes: 100 });
    const out = await runToolCalls({
      runId,
      store,
      extractMetadata: fn,
      calls: [{ name: 'extract_metadata', argsRaw: '{"ref":"/tmp/x.mp4"}' }],
    });
    expect(out[0].ok).toBe(true);
    expect(out[0].result).toEqual({ fileType: 'video', sizeBytes: 100 });
    expect(fn).toHaveBeenCalledWith('/tmp/x.mp4');
  });

  it('check_completeness returns the result of isComplete on current spec', async () => {
    const out = await runToolCalls({
      runId,
      store,
      extractMetadata: vi.fn(),
      calls: [{ name: 'check_completeness', argsRaw: '{}' }],
    });
    expect(out[0].ok).toBe(true);
    const result = out[0].result as { ok: boolean; missing: string[] };
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('unknown tool returns error', async () => {
    const out = await runToolCalls({
      runId,
      store,
      extractMetadata: vi.fn(),
      calls: [{ name: 'mystery', argsRaw: '{}' }],
    });
    expect(out[0].ok).toBe(false);
    expect(out[0].error).toMatch(/unknown/i);
  });
});
