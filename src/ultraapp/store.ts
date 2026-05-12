import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { type AppSpec, makeEmptySpec, validateAppSpec } from './spec.js';

export type RunMode = 'interview' | 'build' | 'done' | 'failed' | 'cancelled';

export interface RunState {
  runId: string;
  mode: RunMode;
  createdAt: string;
  updatedAt: string;
  failure?: string;
}

export interface RunSummary {
  runId: string;
  mode: RunMode;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatEntry {
  role: 'assistant' | 'user' | 'system';
  kind: 'question' | 'answer' | 'free' | 'narrator' | 'error';
  text: string;
  payload?: Record<string, unknown>;
  ts?: string;
}

export interface SpecHistoryEntry {
  ts: string;
  source: 'interview' | 'manual-edit';
  spec: AppSpec;
}

export class UltraappStore {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  async createRun(): Promise<string> {
    const id = `ua-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const dir = this.runDir(id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.mkdir(path.join(dir, 'examples'), { recursive: true });
    const now = new Date().toISOString();
    const state: RunState = { runId: id, mode: 'interview', createdAt: now, updatedAt: now };
    await fsp.writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
    const spec = makeEmptySpec(id);
    await fsp.writeFile(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
    return id;
  }

  async listRuns(): Promise<RunSummary[]> {
    let entries: string[];
    try {
      entries = await fsp.readdir(this.root);
    } catch {
      return [];
    }
    const out: RunSummary[] = [];
    for (const e of entries) {
      if (!e.startsWith('ua-')) continue;
      try {
        const state = await this.readState(e);
        const spec = await this.readSpec(e);
        out.push({
          runId: e,
          mode: state.mode,
          title: spec.meta.title || spec.meta.name || '(untitled)',
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        });
      } catch {
        // skip malformed
      }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }

  async readState(runId: string): Promise<RunState> {
    const raw = await fsp.readFile(path.join(this.runDir(runId), 'state.json'), 'utf8');
    return JSON.parse(raw) as RunState;
  }

  async setMode(runId: string, mode: RunMode, failure?: string): Promise<void> {
    const state = await this.readState(runId);
    state.mode = mode;
    state.updatedAt = new Date().toISOString();
    if (failure !== undefined) state.failure = failure;
    await fsp.writeFile(
      path.join(this.runDir(runId), 'state.json'),
      JSON.stringify(state, null, 2),
    );
  }

  async readSpec(runId: string): Promise<AppSpec> {
    const raw = await fsp.readFile(path.join(this.runDir(runId), 'spec.json'), 'utf8');
    return JSON.parse(raw) as AppSpec;
  }

  async writeSpec(
    runId: string,
    spec: AppSpec,
    source: SpecHistoryEntry['source'] = 'interview',
  ): Promise<void> {
    spec.updatedAt = new Date().toISOString();
    validateAppSpec(spec);
    const dir = this.runDir(runId);
    await fsp.writeFile(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
    const entry: SpecHistoryEntry = { ts: spec.updatedAt, source, spec };
    await fsp.appendFile(path.join(dir, 'spec.history.jsonl'), JSON.stringify(entry) + '\n');
    const state = await this.readState(runId);
    state.updatedAt = spec.updatedAt;
    await fsp.writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  }

  async readSpecHistory(runId: string): Promise<SpecHistoryEntry[]> {
    try {
      const raw = await fsp.readFile(path.join(this.runDir(runId), 'spec.history.jsonl'), 'utf8');
      return raw
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as SpecHistoryEntry);
    } catch {
      return [];
    }
  }

  async appendChat(runId: string, entry: ChatEntry): Promise<void> {
    const e: ChatEntry = { ...entry, ts: entry.ts ?? new Date().toISOString() };
    await fsp.appendFile(path.join(this.runDir(runId), 'chat.jsonl'), JSON.stringify(e) + '\n');
  }

  async readChat(runId: string): Promise<ChatEntry[]> {
    try {
      const raw = await fsp.readFile(path.join(this.runDir(runId), 'chat.jsonl'), 'utf8');
      return raw
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as ChatEntry);
    } catch {
      return [];
    }
  }

  examplesDir(runId: string): string {
    return path.join(this.runDir(runId), 'examples');
  }

  rootDir(): string {
    return this.root;
  }

  private runDir(runId: string): string {
    if (!/^ua-[a-zA-Z0-9-]+$/.test(runId)) throw new Error(`bad runId: ${runId}`);
    return path.join(this.root, runId);
  }
}

export function defaultStoreRoot(): string {
  const home = process.env.HOME ?? process.cwd();
  return path.join(home, '.claw-orchestrator', 'ultraapps');
}
