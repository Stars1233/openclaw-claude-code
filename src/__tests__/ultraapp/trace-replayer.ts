/**
 * Trace replayer — runs a JSONL reference trace through the real
 * UltraappManager + UltraappStore against a stubbed SessionManager whose
 * sendMessage replies are pre-loaded from `claude-*` entries in trace order.
 *
 * Returns the runId + the on-disk spec.json after replay; callers compare
 * against a frozen `expected/<trace>.appspec.json` snapshot.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { vi } from 'vitest';
import { UltraappManager } from '../../ultraapp/manager.js';
import { UltraappStore } from '../../ultraapp/store.js';

export interface TraceEntry {
  kind: string;
  [k: string]: unknown;
}

interface ReplayResult {
  runId: string;
  specJson: unknown;
}

export async function replayTrace(traceFile: string, storeRoot: string): Promise<ReplayResult> {
  const entries: TraceEntry[] = fs
    .readFileSync(traceFile, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));

  // Build the reply queue from the claude-* entries in order. Each entry
  // becomes ONE sendMessage reply.
  const replies: string[] = [];
  for (const e of entries) {
    if (e.kind === 'claude-question') {
      replies.push('```question\n' + JSON.stringify(e.envelope) + '\n```');
    } else if (e.kind === 'claude-tool') {
      const args = JSON.stringify(e.args ?? {});
      replies.push(`<tool name="${e.tool as string}">${args}</tool>`);
    } else if (e.kind === 'claude-complete') {
      const summary = (e.summary as string) ?? 'Done.';
      replies.push(`${summary}\n[INTERVIEW: COMPLETE]`);
    }
  }

  // Pre-loaded extract_metadata results, keyed by call order
  const extractResults: unknown[] = [];
  for (const e of entries) {
    if (e.kind === 'claude-tool' && e.tool === 'extract_metadata' && e.result !== undefined) {
      extractResults.push(e.result);
    }
  }
  let extractIdx = 0;

  let i = 0;
  const sm = {
    startSession: vi
      .fn()
      .mockImplementation(async (cfg: { name?: string }) => ({ name: cfg.name ?? 'replay' })),
    sendMessage: vi
      .fn()
      .mockImplementation(async () => ({ output: replies[i++] ?? '[INTERVIEW: COMPLETE]' })),
    stopSession: vi.fn().mockResolvedValue(undefined),
  };

  const store = new UltraappStore(storeRoot);
  // Inline-stub extractMetadata via a custom files import isn't easy without
  // refactoring the manager. For replay traces that need extract_metadata
  // results, we monkey-patch via the manager's testing seam: the trace
  // currently embeds extract results, but the real implementation reads from
  // disk. We rely on the manager's existing default extractMetadata, which
  // for path-ref entries calls ffprobe. For unit-tests we stub via files.ts
  // (see future work).
  void extractResults;
  void extractIdx;

  const mgr = new UltraappManager({ store, sessionManager: sm as never });
  const runId = await mgr.createRun();

  // Walk the trace and execute user actions. Allow microtasks to flush
  // between actions so driveTurn-spawned tool followups consume their
  // reply slots before the next user action.
  for (const e of entries) {
    if (e.kind === 'user-answer') {
      await mgr.submitAnswer(runId, {
        value: e.value as string,
        freeform: e.freeform as string | undefined,
      });
    } else if (e.kind === 'user-file') {
      const data = Buffer.from(e['contents-b64'] as string, 'base64');
      await mgr.addFile(runId, { kind: 'upload', filename: e.filename as string, data });
    } else if (e.kind === 'user-path') {
      await mgr.addFile(runId, { kind: 'path', absolutePath: e.absolutePath as string });
    } else {
      // claude-* entries are passive (consumed by sendMessage). Just yield.
    }
    // Drain microtasks so the chained driveTurn → tool → driveTurn sequence
    // consumes its reply slots before the next user action.
    for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
  }

  // Final drain so the closing complete reply (if any) lands on disk.
  for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));

  const specJson = JSON.parse(
    fs.readFileSync(path.join(store.runDirAbsolute(runId), 'spec.json'), 'utf8'),
  );
  return { runId, specJson };
}

/** Strips fields whose values change every replay (ids, timestamps). */
export function stripVolatile(spec: unknown): unknown {
  const s = JSON.parse(JSON.stringify(spec)) as {
    runId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  delete s.runId;
  delete s.createdAt;
  delete s.updatedAt;
  return s;
}
