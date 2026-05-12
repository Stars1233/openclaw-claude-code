import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AppSpec } from './spec.js';
import { type UltraappStore, type ChatEntry } from './store.js';
import { parseInterviewReply, type QuestionEnvelope } from './interview-parser.js';
import { runToolCalls } from './interview-tools.js';
import { extractMetadata as defaultExtractMetadata, ingestUpload, validateLocalPath, defaultAllowedRoots } from './files.js';
import { applyPatch, type PatchOp } from './json-patch.js';

export type RunEvent =
  | { type: 'question'; question: QuestionEnvelope }
  | { type: 'spec-updated'; spec: AppSpec }
  | { type: 'chat'; entry: ChatEntry }
  | { type: 'completeness'; ok: boolean; missing: string[] }
  | { type: 'interview-complete'; summary: string }
  | { type: 'error'; message: string };

interface SessionManagerLike {
  startSession(config: {
    name?: string;
    engine?: string;
    model?: string;
    cwd?: string;
    systemPrompt?: string;
    permissionMode?: string;
  }): Promise<{ name: string }>;
  sendMessage(name: string, message: string): Promise<{ output: string }>;
  stopSession(name: string): Promise<void>;
}

export interface UltraappManagerOptions {
  store: UltraappStore;
  sessionManager: SessionManagerLike;
  skillPath?: string;
}

interface ActiveRun {
  runId: string;
  sessionName: string;
  emitter: EventEmitter;
}

const SESSION_KICKOFF =
  'Begin the ultraapp interview now. Ask the first question per the skill contract.';

export class UltraappManager {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly skillContent: string;

  constructor(private readonly opts: UltraappManagerOptions) {
    this.skillContent = loadSkill(opts.skillPath);
  }

  async createRun(): Promise<string> {
    const runId = await this.opts.store.createRun();
    const sessionName = `ultraapp-${runId}`;
    await this.opts.sessionManager.startSession({
      name: sessionName,
      engine: 'claude',
      model: 'claude-opus-4-7',
      cwd: process.cwd(),
      systemPrompt: this.skillContent,
      permissionMode: 'bypassPermissions',
    });
    const run: ActiveRun = { runId, sessionName, emitter: new EventEmitter() };
    this.runs.set(runId, run);
    void this.driveTurn(run, SESSION_KICKOFF);
    return runId;
  }

  async submitAnswer(
    runId: string,
    answer: { value: string; freeform?: string },
  ): Promise<void> {
    const run = this.requireRun(runId);
    const text = answer.freeform ? answer.freeform : `I picked: ${answer.value}`;
    await this.opts.store.appendChat(runId, { role: 'user', kind: 'answer', text });
    this.emit(run, { type: 'chat', entry: { role: 'user', kind: 'answer', text } });
    void this.driveTurn(run, text);
  }

  async applySpecEdit(runId: string, patch: PatchOp[]): Promise<void> {
    const run = this.requireRun(runId);
    const spec = await this.opts.store.readSpec(runId);
    const next = applyPatch(spec, patch);
    await this.opts.store.writeSpec(runId, next as typeof spec, 'manual-edit');
    this.emit(run, { type: 'spec-updated', spec: next as AppSpec });
    void this.driveTurn(
      run,
      `[system] User manually edited spec: ${JSON.stringify(patch)}. Re-evaluate later questions.`,
    );
  }

  async addFile(
    runId: string,
    args:
      | { kind: 'upload'; filename: string; data: Buffer }
      | { kind: 'path'; absolutePath: string },
  ): Promise<{ ref: string }> {
    const run = this.requireRun(runId);
    let ref: string;
    if (args.kind === 'upload') {
      ref = await ingestUpload(this.opts.store.examplesDir(runId), args.filename, args.data);
    } else {
      validateLocalPath(args.absolutePath, { allow: defaultAllowedRoots() });
      ref = args.absolutePath;
    }
    await this.opts.store.appendChat(runId, {
      role: 'system',
      kind: 'free',
      text: `[file added] ${path.basename(ref)}`,
      payload: { ref },
    });
    void this.driveTurn(
      run,
      `[system] User added file: ${ref}. You may call extract_metadata.`,
    );
    return { ref };
  }

  subscribe(runId: string, listener: (ev: RunEvent) => void): () => void {
    const run = this.requireRun(runId);
    run.emitter.on('event', listener);
    return () => run.emitter.off('event', listener);
  }

  private async driveTurn(run: ActiveRun, message: string): Promise<void> {
    try {
      const { output } = await this.opts.sessionManager.sendMessage(run.sessionName, message);
      const parsed = parseInterviewReply(output);

      if (parsed.kind === 'tools') {
        const results = await runToolCalls({
          runId: run.runId,
          store: this.opts.store,
          extractMetadata: defaultExtractMetadata,
          calls: parsed.toolCalls,
        });
        const spec = await this.opts.store.readSpec(run.runId);
        this.emit(run, { type: 'spec-updated', spec });
        const followup = results
          .map(
            (r) =>
              `<tool_result name="${r.name}">${
                r.ok ? JSON.stringify(r.result) : `ERROR: ${r.error}`
              }</tool_result>`,
          )
          .join('\n');
        void this.driveTurn(run, followup);
        return;
      }

      if (parsed.kind === 'question') {
        await this.opts.store.appendChat(run.runId, {
          role: 'assistant',
          kind: 'question',
          text: parsed.question.question,
          payload: { ...parsed.question },
        });
        this.emit(run, { type: 'question', question: parsed.question });
        return;
      }

      if (parsed.kind === 'complete') {
        await this.opts.store.appendChat(run.runId, {
          role: 'assistant',
          kind: 'narrator',
          text: parsed.summary,
        });
        this.emit(run, { type: 'interview-complete', summary: parsed.summary });
        return;
      }

      if (parsed.kind === 'text') {
        await this.opts.store.appendChat(run.runId, {
          role: 'assistant',
          kind: 'free',
          text: parsed.text,
        });
        this.emit(run, {
          type: 'chat',
          entry: { role: 'assistant', kind: 'free', text: parsed.text },
        });
        return;
      }

      this.emit(run, { type: 'error', message: parsed.reason });
    } catch (e) {
      this.emit(run, { type: 'error', message: (e as Error).message });
    }
  }

  private emit(run: ActiveRun, ev: RunEvent): void {
    run.emitter.emit('event', ev);
  }

  private requireRun(runId: string): ActiveRun {
    const r = this.runs.get(runId);
    if (!r) throw new Error(`unknown runId: ${runId}`);
    return r;
  }
}

function loadSkill(skillPath?: string): string {
  if (skillPath) {
    try {
      return fs.readFileSync(skillPath, 'utf8');
    } catch {
      /* fall through */
    }
  }
  // Resolve relative to this module: src/ultraapp/manager.ts → ../../skills/ultraapp/SKILL.md
  // After build, dist/src/ultraapp/manager.js → ../../../skills/ultraapp/SKILL.md
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../skills/ultraapp/SKILL.md'),
    path.resolve(here, '../../../skills/ultraapp/SKILL.md'),
    path.resolve(process.cwd(), 'skills/ultraapp/SKILL.md'),
  ];
  for (const c of candidates) {
    try {
      return fs.readFileSync(c, 'utf8');
    } catch {
      /* try next */
    }
  }
  // Test fallback — minimal but functional contract
  return [
    'You are running the ultraapp interview. Emit one question per turn as a fenced ```question JSON block with',
    '{"question": str, "options": [{"label": str, "value": str}], "recommended": str, "freeformAccepted": bool, "context"?: str}.',
    'Use <tool name="update_spec">[...JSON Patch...]</tool>, <tool name="extract_metadata">{"ref": str}</tool>,',
    '<tool name="check_completeness">{}</tool>. End with [INTERVIEW: COMPLETE] when done.',
  ].join(' ');
}
