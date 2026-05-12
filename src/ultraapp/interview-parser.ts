export interface QuestionEnvelope {
  question: string;
  options: Array<{ label: string; value: string }>;
  recommended: string;
  freeformAccepted: boolean;
  context?: string;
}

export interface ToolCall {
  name: string;
  argsRaw: string;
}

export type ParsedReply =
  | { kind: 'question'; question: QuestionEnvelope; rawText: string }
  | { kind: 'complete'; summary: string }
  | { kind: 'tools'; toolCalls: ToolCall[]; rawText: string }
  | { kind: 'text'; text: string }
  | { kind: 'error'; reason: string };

const FENCE_RE = /```question\s*\n([\s\S]*?)\n```/;
const COMPLETE_RE = /^\[INTERVIEW:\s*COMPLETE\]\s*$/m;
const TOOL_RE = /<tool\s+name="([a-z_]+)"\s*>([\s\S]*?)<\/tool>/g;

export function parseInterviewReply(reply: string): ParsedReply {
  const tools: ToolCall[] = [];
  let m: RegExpExecArray | null;
  TOOL_RE.lastIndex = 0;
  while ((m = TOOL_RE.exec(reply)) !== null) {
    tools.push({ name: m[1], argsRaw: m[2].trim() });
  }
  if (tools.length > 0) {
    return { kind: 'tools', toolCalls: tools, rawText: reply };
  }

  if (COMPLETE_RE.test(reply)) {
    return { kind: 'complete', summary: reply.replace(COMPLETE_RE, '').trim() };
  }

  const fence = FENCE_RE.exec(reply);
  if (fence) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fence[1]);
    } catch (e) {
      return {
        kind: 'error',
        reason: `malformed JSON in question fence: ${(e as Error).message}`,
      };
    }
    const v = validateQuestion(parsed);
    if (v.ok) return { kind: 'question', question: v.value, rawText: reply };
    return { kind: 'error', reason: v.reason };
  }

  return { kind: 'text', text: reply.trim() };
}

function validateQuestion(x: unknown): { ok: true; value: QuestionEnvelope } | { ok: false; reason: string } {
  if (!x || typeof x !== 'object') return { ok: false, reason: 'envelope is not an object' };
  const o = x as Record<string, unknown>;
  if (typeof o.question !== 'string' || o.question.length === 0) return { ok: false, reason: 'missing .question' };
  if (!Array.isArray(o.options) || o.options.length < 1) return { ok: false, reason: 'missing .options' };
  for (const opt of o.options) {
    if (!opt || typeof opt !== 'object') return { ok: false, reason: 'option is not an object' };
    const oo = opt as Record<string, unknown>;
    if (typeof oo.label !== 'string' || typeof oo.value !== 'string') {
      return { ok: false, reason: 'option missing label/value' };
    }
  }
  if (typeof o.recommended !== 'string') return { ok: false, reason: 'missing .recommended' };
  return {
    ok: true,
    value: {
      question: o.question,
      options: o.options as Array<{ label: string; value: string }>,
      recommended: o.recommended,
      freeformAccepted: o.freeformAccepted === true,
      context: typeof o.context === 'string' ? o.context : undefined,
    },
  };
}
