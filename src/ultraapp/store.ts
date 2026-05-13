import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { type AppSpec, makeEmptySpec, validateAppSpecShape } from './spec.js';

/**
 * Atomic write: render to `<file>.tmp.<pid>.<rand>`, then rename(2) onto the
 * target. POSIX rename is atomic, so concurrent readers either see the old
 * file or the new — never the partial write that `fsp.writeFile`'s
 * truncate-then-stream sequence exposes. The mid-poll-loop "Expected ',' or
 * '}' after property value" JSON errors that hit the manager-test in CI
 * came from exactly that window.
 */
async function atomicWriteJson(file: string, body: string): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  await fsp.writeFile(tmp, body);
  await fsp.rename(tmp, file);
}

export type RunMode =
  | 'interview'
  | 'queued'
  | 'building'
  | 'build-complete'
  | 'deploying'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface DeployInfo {
  url: string;
  port: number;
  containerName: string;
  imageTag: string;
}

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
    await atomicWriteJson(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
    const spec = makeEmptySpec(id);
    await atomicWriteJson(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
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
    await atomicWriteJson(path.join(this.runDir(runId), 'state.json'), JSON.stringify(state, null, 2));
  }

  async readSpec(runId: string): Promise<AppSpec> {
    const raw = await fsp.readFile(path.join(this.runDir(runId), 'spec.json'), 'utf8');
    return JSON.parse(raw) as AppSpec;
  }

  async writeSpec(runId: string, spec: AppSpec, source: SpecHistoryEntry['source'] = 'interview'): Promise<void> {
    spec.updatedAt = new Date().toISOString();
    // Lax shape-only check: cross-ref + DAG strict checks happen at startBuild,
    // not on every interview patch. Claude iterates incrementally and transient
    // invalid states (e.g., a step refs an input not yet declared) are normal.
    validateAppSpecShape(spec);
    const dir = this.runDir(runId);
    await atomicWriteJson(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
    const entry: SpecHistoryEntry = { ts: spec.updatedAt, source, spec };
    await fsp.appendFile(path.join(dir, 'spec.history.jsonl'), JSON.stringify(entry) + '\n');
    const state = await this.readState(runId);
    state.updatedAt = spec.updatedAt;
    await atomicWriteJson(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
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
    try {
      await fsp.appendFile(path.join(this.runDir(runId), 'chat.jsonl'), JSON.stringify(e) + '\n');
    } catch (err) {
      // Swallow ENOENT: the only way to hit it is if the runDir was removed
      // out from under us, which production never does — but test teardown's
      // rmSync can race a still-pending background appendChat from a tracked
      // promise's microtask continuation. Surface every other error.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
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

  worktreesDir(runId: string): string {
    return path.join(this.runDir(runId), 'worktrees');
  }

  versionsDir(runId: string): string {
    return path.join(this.runDir(runId), 'versions');
  }

  runDirAbsolute(runId: string): string {
    return this.runDir(runId);
  }

  async recordBuildArtifact(runId: string, args: { worktreePath: string; version: string }): Promise<void> {
    const dir = path.join(this.versionsDir(runId), args.version);
    await fsp.mkdir(dir, { recursive: true });
    await atomicWriteJson(
      path.join(dir, 'artifact.json'),
      JSON.stringify({ worktreePath: args.worktreePath, builtAt: new Date().toISOString() }, null, 2),
    );
  }

  async readArtifacts(runId: string): Promise<
    Array<{
      version: string;
      worktreePath: string;
      builtAt: string;
      deploy?: DeployInfo;
      deployedAt?: string;
    }>
  > {
    try {
      const versions = await fsp.readdir(this.versionsDir(runId));
      const out: Array<{
        version: string;
        worktreePath: string;
        builtAt: string;
        deploy?: DeployInfo;
        deployedAt?: string;
      }> = [];
      for (const v of versions) {
        try {
          const a = JSON.parse(await fsp.readFile(path.join(this.versionsDir(runId), v, 'artifact.json'), 'utf8')) as {
            worktreePath: string;
            builtAt: string;
            deploy?: DeployInfo;
            deployedAt?: string;
          };
          out.push({
            version: v,
            worktreePath: a.worktreePath,
            builtAt: a.builtAt,
            deploy: a.deploy,
            deployedAt: a.deployedAt,
          });
        } catch {
          /* skip */
        }
      }
      return out.sort((a, b) => a.version.localeCompare(b.version));
    } catch {
      return [];
    }
  }

  async recordDeploy(runId: string, version: string, deploy: DeployInfo): Promise<void> {
    const file = path.join(this.versionsDir(runId), version, 'artifact.json');
    const cur = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>;
    cur.deploy = deploy;
    cur.deployedAt = new Date().toISOString();
    await atomicWriteJson(file, JSON.stringify(cur, null, 2));
  }

  async deleteRunFiles(runId: string): Promise<void> {
    await fsp.rm(this.runDir(runId), { recursive: true, force: true });
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
