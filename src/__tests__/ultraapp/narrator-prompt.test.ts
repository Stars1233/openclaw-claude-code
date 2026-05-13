import { describe, it, expect } from 'vitest';
import { NARRATOR_SYSTEM_PROMPT, composeNarratorBatch } from '../../ultraapp/narrator-prompt.js';
import type { BuildEvent } from '../../ultraapp/build-events.js';

describe('NARRATOR_SYSTEM_PROMPT', () => {
  it('describes the narrator role and language constraints', () => {
    expect(NARRATOR_SYSTEM_PROMPT).toMatch(/narrat/i);
    expect(NARRATOR_SYSTEM_PROMPT).toMatch(/co-worker|colleague|engineer/i);
    expect(NARRATOR_SYSTEM_PROMPT).toMatch(/short|concise|terse/i);
    expect(NARRATOR_SYSTEM_PROMPT).toMatch(/match.*language|user.*language/i);
  });
  it('forbids hallucinating events not in the input', () => {
    expect(NARRATOR_SYSTEM_PROMPT).toMatch(/(only|don'?t)/i);
    expect(NARRATOR_SYSTEM_PROMPT).toMatch(/given|input|provided|receive/i);
  });
});

describe('composeNarratorBatch', () => {
  const events: BuildEvent[] = [
    { type: 'build-start', runId: 'r1' },
    { type: 'council-round', runId: 'r1', round: 1, agentName: 'agent-A' },
    { type: 'council-round', runId: 'r1', round: 1, agentName: 'agent-A', vote: 'NO' },
  ];

  it('embeds the events as JSON', () => {
    const u = composeNarratorBatch(events, 'en');
    expect(u).toContain('build-start');
    expect(u).toContain('agent-A');
  });
  it('hints language to use', () => {
    expect(composeNarratorBatch(events, 'en')).toMatch(/English/i);
    expect(composeNarratorBatch(events, 'zh')).toMatch(/Chinese|中文/);
  });
  it('returns empty string for empty event list', () => {
    expect(composeNarratorBatch([], 'en')).toBe('');
  });
});
