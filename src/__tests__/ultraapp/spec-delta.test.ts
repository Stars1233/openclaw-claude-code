import { describe, it, expect, vi } from 'vitest';
import { startSpecDeltaInterview, composeDeltaBootstrap } from '../../ultraapp/spec-delta.js';
import { makeEmptySpec } from '../../ultraapp/spec.js';

describe('composeDeltaBootstrap', () => {
  it('embeds the existing spec + the user feedback', () => {
    const spec = makeEmptySpec('ua-1');
    spec.meta.name = 'demo';
    const prompt = composeDeltaBootstrap(spec, 'add a thumbnail step');
    expect(prompt).toContain('"name": "demo"');
    expect(prompt).toContain('add a thumbnail step');
    expect(prompt).toMatch(/FOCUSED|focused/);
    expect(prompt).toMatch(/INTERVIEW: COMPLETE/);
  });
});

describe('startSpecDeltaInterview', () => {
  it('injects bootstrap into the run session and flips mode back to interview', async () => {
    const manager = {
      injectSystemMessage: vi.fn().mockResolvedValue(undefined),
      setModeForDelta: vi.fn().mockResolvedValue(undefined),
    };
    const spec = makeEmptySpec('ua-1');
    spec.meta.name = 'demo';
    await startSpecDeltaInterview(manager as never, 'ua-1', 'add thumbnail', spec);
    expect(manager.injectSystemMessage).toHaveBeenCalledWith(
      'ua-1',
      expect.stringMatching(/add thumbnail/),
    );
    expect(manager.setModeForDelta).toHaveBeenCalledWith('ua-1');
  });
});
