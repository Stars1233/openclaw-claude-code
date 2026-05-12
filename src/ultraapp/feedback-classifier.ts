/**
 * Done-mode feedback classifier — single Haiku call categorising user input
 * into cosmetic / spec-delta / structural so the manager can route it.
 *
 * Safe-default fallback: if the LLM call fails or returns malformed output,
 * we return spec-delta (cheaper to recover from than wrongly running the
 * patcher on a structural change).
 */

import type { AppSpec } from './spec.js';

export interface ClassifyArgs {
  text: string;
  currentSpec: AppSpec;
  language: 'zh' | 'en';
  llmCall: (prompt: string) => Promise<{ output: string }>;
}

export type FeedbackClass = 'cosmetic' | 'spec-delta' | 'structural';

export interface ClassifyResult {
  class: FeedbackClass;
  reason: string;
  proposedAction: string;
}

const SYSTEM = `
You classify post-deploy user feedback for ultraapp into one of three buckets:

  cosmetic   — visual/UI tweak; doesn't change AppSpec
               (e.g., "button too dark", "logo too small", "use a serif font")
  spec-delta — adds, removes, or changes a step / input / output / runtime field
               (e.g., "also output a thumbnail", "input should accept audio")
  structural — workflow doesn't fit the original AppSpec at all; better to
               start a fresh ultraapp run
               (e.g., "this isn't even the right pipeline", "I want a totally
               different app")

Return JSON in a fenced \`\`\`classification block:

{
  "class": "cosmetic" | "spec-delta" | "structural",
  "reason": "<one sentence explanation>",
  "proposedAction": "<one phrase: e.g., 'apply patch' / 'focused interview on outputs' / 'suggest new run'>"
}

Be conservative: when in doubt, prefer spec-delta over structural (cheaper to
recover from). Prefer cosmetic over spec-delta only when you're confident the
change is purely visual.
`.trim();

const FENCE_RE = /```classification\s*\n([\s\S]*?)\n```/;

export async function classifyFeedback(args: ClassifyArgs): Promise<ClassifyResult> {
  const userPrompt = `Current AppSpec (JSON):

\`\`\`json
${JSON.stringify(args.currentSpec, null, 2)}
\`\`\`

User feedback (in ${args.language === 'zh' ? 'Chinese' : 'English'}):

> ${args.text}

Classify it.`;

  let output: string;
  try {
    const r = await args.llmCall(`${SYSTEM}\n\n${userPrompt}`);
    output = r.output;
  } catch (e) {
    return {
      class: 'spec-delta',
      reason: `classifier error: ${(e as Error).message} (fallback)`,
      proposedAction: 'focused interview',
    };
  }
  const m = FENCE_RE.exec(output);
  if (!m) {
    return {
      class: 'spec-delta',
      reason: 'malformed classifier output (fallback to spec-delta)',
      proposedAction: 'focused interview',
    };
  }
  try {
    const j = JSON.parse(m[1]) as Partial<ClassifyResult>;
    if (j.class === 'cosmetic' || j.class === 'spec-delta' || j.class === 'structural') {
      return {
        class: j.class,
        reason: j.reason ?? '',
        proposedAction: j.proposedAction ?? '',
      };
    }
  } catch {
    /* fall through */
  }
  return {
    class: 'spec-delta',
    reason: 'malformed classifier JSON (fallback)',
    proposedAction: 'focused interview',
  };
}
