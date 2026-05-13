/**
 * BuildEvent — emitted by UltraappBuildQueue and the worker fn during a build.
 * Consumed by UltraappManager.onBuildEvent for narration + per-run SSE relay.
 */

export type BuildEvent =
  | { type: 'queued'; runId: string; position: number }
  | { type: 'build-start'; runId: string }
  | {
      type: 'council-round';
      runId: string;
      round: number;
      agentName: string;
      vote?: 'YES' | 'NO';
    }
  | { type: 'council-consensus'; runId: string; rounds: number }
  | { type: 'fix-start'; runId: string }
  | { type: 'fix-round'; runId: string; round: number; failingCommand: string }
  | { type: 'fix-complete'; runId: string; rounds: number }
  | { type: 'build-complete'; runId: string; worktreePath: string }
  | {
      type: 'build-failed';
      runId: string;
      phase: 'council' | 'fix-on-failure' | 'orchestrator';
      reason: string;
    }
  | { type: 'build-cancelled'; runId: string };
