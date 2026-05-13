import { describe, it, expect, vi } from 'vitest';
import { classifyFeedback } from '../../ultraapp/feedback-classifier.js';
import { makeEmptySpec } from '../../ultraapp/spec.js';

function fakeLLM(reply: string) {
  return vi.fn().mockResolvedValue({ output: reply });
}

describe('classifyFeedback', () => {
  const spec = makeEmptySpec('ua-1');

  it('classifies cosmetic correctly', async () => {
    const llm = fakeLLM(
      '```classification\n{"class":"cosmetic","reason":"button color","proposedAction":"swap blue to green"}\n```',
    );
    const r = await classifyFeedback({
      text: '按钮颜色改成绿色',
      currentSpec: spec,
      language: 'zh',
      llmCall: llm,
    });
    expect(r.class).toBe('cosmetic');
  });

  it('classifies spec-delta correctly', async () => {
    const llm = fakeLLM(
      '```classification\n{"class":"spec-delta","reason":"new pipeline step","proposedAction":"focused interview"}\n```',
    );
    const r = await classifyFeedback({
      text: 'add a thumbnail step',
      currentSpec: spec,
      language: 'en',
      llmCall: llm,
    });
    expect(r.class).toBe('spec-delta');
  });

  it('classifies structural correctly', async () => {
    const llm = fakeLLM(
      '```classification\n{"class":"structural","reason":"different workflow","proposedAction":"new run"}\n```',
    );
    const r = await classifyFeedback({
      text: 'this is the wrong app entirely',
      currentSpec: spec,
      language: 'en',
      llmCall: llm,
    });
    expect(r.class).toBe('structural');
  });

  it('falls back to spec-delta when LLM output is malformed', async () => {
    const llm = fakeLLM('not parseable');
    const r = await classifyFeedback({
      text: 'huh',
      currentSpec: spec,
      language: 'en',
      llmCall: llm,
    });
    expect(r.class).toBe('spec-delta');
    expect(r.reason).toMatch(/fallback|malformed/i);
  });

  it('falls back when LLM call rejects', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('rate limited'));
    const r = await classifyFeedback({
      text: 'huh',
      currentSpec: spec,
      language: 'en',
      llmCall: llm,
    });
    expect(r.class).toBe('spec-delta');
    expect(r.reason).toMatch(/rate limited|fallback/i);
  });

  it('falls back when JSON parses but class is invalid', async () => {
    const llm = fakeLLM('```classification\n{"class":"unknown","reason":"x","proposedAction":"y"}\n```');
    const r = await classifyFeedback({
      text: 'huh',
      currentSpec: spec,
      language: 'en',
      llmCall: llm,
    });
    expect(r.class).toBe('spec-delta');
  });

  it('hints language to use in prompt', async () => {
    const llm = vi
      .fn()
      .mockResolvedValue({ output: '```classification\n{"class":"cosmetic","reason":"r","proposedAction":"a"}\n```' });
    await classifyFeedback({ text: 'foo', currentSpec: spec, language: 'zh', llmCall: llm });
    expect(llm.mock.calls[0][0]).toMatch(/Chinese/);
  });
});
