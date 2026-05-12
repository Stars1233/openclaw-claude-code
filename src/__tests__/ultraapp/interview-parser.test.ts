import { describe, it, expect } from 'vitest';
import { parseInterviewReply } from '../../ultraapp/interview-parser.js';

describe('parseInterviewReply', () => {
  it('extracts a question envelope from a fenced ```question block', () => {
    const reply = `Sure, next question.\n\n\`\`\`question
{
  "question": "input type?",
  "options": [{"label":"a","value":"a"}, {"label":"b","value":"b"}],
  "recommended": "a",
  "freeformAccepted": true,
  "context": "from your uploaded sample"
}
\`\`\`\n\nLet me know.`;
    const r = parseInterviewReply(reply);
    expect(r.kind).toBe('question');
    if (r.kind !== 'question') throw new Error();
    expect(r.question.question).toBe('input type?');
    expect(r.question.options.length).toBe(2);
    expect(r.question.recommended).toBe('a');
  });

  it('detects [INTERVIEW: COMPLETE] marker', () => {
    const reply =
      'Spec summary:\n- inputs: video\n- outputs: clip\n\n[INTERVIEW: COMPLETE]';
    const r = parseInterviewReply(reply);
    expect(r.kind).toBe('complete');
  });

  it('returns plain text reply when no envelope or marker present', () => {
    const r = parseInterviewReply('hmm let me think more');
    expect(r.kind).toBe('text');
  });

  it('rejects malformed JSON inside fence', () => {
    const reply = '```question\n{not json}\n```';
    const r = parseInterviewReply(reply);
    expect(r.kind).toBe('error');
  });

  it('rejects question envelope missing required fields', () => {
    const reply = '```question\n{"question":"x"}\n```';
    const r = parseInterviewReply(reply);
    expect(r.kind).toBe('error');
  });

  it('extracts tool calls from XML-style tags', () => {
    const reply = `Here we go.\n<tool name="update_spec">{"op":"replace","path":"/meta/name","value":"vlog"}</tool>\nNext question coming.`;
    const r = parseInterviewReply(reply);
    expect(r.kind).toBe('tools');
    if (r.kind !== 'tools') throw new Error();
    expect(r.toolCalls.length).toBe(1);
    expect(r.toolCalls[0].name).toBe('update_spec');
    expect(r.toolCalls[0].argsRaw).toContain('vlog');
  });
});
