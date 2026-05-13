/**
 * Spec-delta — focused mini-interview when the user's done-mode feedback
 * implies an AppSpec change rather than a cosmetic patch.
 *
 * Reuses the existing interview engine wholesale: we only inject a bootstrap
 * system message naming the slots in scope and flip the run's mode back to
 * 'interview'. The user then answers as in v0.1, and on [INTERVIEW: COMPLETE]
 * the existing build flow takes over (council rerun is wired in v0.5+ — for
 * v0.5 the user clicks Start Build manually for the focused rerun).
 */

import type { AppSpec } from './spec.js';

interface SpecDeltaManagerLike {
  injectSystemMessage(runId: string, text: string): Promise<void>;
  setModeForDelta(runId: string): Promise<void>;
}

export function composeDeltaBootstrap(spec: AppSpec, feedback: string): string {
  return `The user has a previously-deployed ultraapp with the AppSpec below. They've
just sent feedback that requires a spec change. Run a FOCUSED interview that
asks ONLY about the slots that need to change to honour the feedback. Do not
re-confirm slots that are unaffected.

When the focused interview is done, call check_completeness and emit
[INTERVIEW: COMPLETE] as usual. The user can then click Start Build to
trigger a delta-aware council rerun.

## Existing AppSpec

\`\`\`json
${JSON.stringify(spec, null, 2)}
\`\`\`

## User feedback

${feedback}`;
}

export async function startSpecDeltaInterview(
  manager: SpecDeltaManagerLike,
  runId: string,
  feedback: string,
  currentSpec: AppSpec,
): Promise<void> {
  await manager.injectSystemMessage(runId, composeDeltaBootstrap(currentSpec, feedback));
  await manager.setModeForDelta(runId);
}
