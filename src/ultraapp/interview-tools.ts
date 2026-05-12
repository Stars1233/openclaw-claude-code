import { applyPatch } from './json-patch.js';
import { isComplete } from './spec.js';
import type { UltraappStore } from './store.js';
import type { ToolCall } from './interview-parser.js';
import type { FileMetadata } from './files.js';

export interface ToolResult {
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface RunToolsArgs {
  runId: string;
  store: UltraappStore;
  extractMetadata: (ref: string) => Promise<FileMetadata>;
  calls: ToolCall[];
}

export async function runToolCalls(args: RunToolsArgs): Promise<ToolResult[]> {
  const out: ToolResult[] = [];
  for (const call of args.calls) {
    out.push(await dispatch(call, args));
  }
  return out;
}

async function dispatch(call: ToolCall, args: RunToolsArgs): Promise<ToolResult> {
  try {
    if (call.name === 'update_spec') {
      const patch = JSON.parse(call.argsRaw) as Array<{
        op: string;
        path: string;
        value?: unknown;
      }>;
      const spec = await args.store.readSpec(args.runId);
      const next = applyPatch(spec, patch);
      await args.store.writeSpec(args.runId, next as typeof spec);
      return { name: call.name, ok: true, result: { applied: patch.length } };
    }
    if (call.name === 'extract_metadata') {
      const a = JSON.parse(call.argsRaw) as { ref: string };
      if (typeof a.ref !== 'string') throw new Error('extract_metadata requires .ref');
      const meta = await args.extractMetadata(a.ref);
      return { name: call.name, ok: true, result: meta };
    }
    if (call.name === 'check_completeness') {
      const spec = await args.store.readSpec(args.runId);
      return { name: call.name, ok: true, result: isComplete(spec) };
    }
    return { name: call.name, ok: false, error: `unknown tool: ${call.name}` };
  } catch (e) {
    return { name: call.name, ok: false, error: (e as Error).message };
  }
}
