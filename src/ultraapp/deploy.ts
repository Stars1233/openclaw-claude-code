/**
 * Deploy orchestrator: docker build → allocate port → docker run →
 * register with router → wait for /health to pass → return URL.
 *
 * All side-effecting collaborators (docker, router, fetch) are injected so
 * unit tests can drive the state machine without real docker.
 */

import * as path from 'node:path';
import type { BuildResult, DockerRunResult } from './docker.js';

export interface DeployArgs {
  runId: string;
  version: string;
  worktreePath: string;
  slug: string;
  hostDataDir: string;
  dockerBuild: (a: {
    tag: string;
    cwd: string;
    buildArgs: Record<string, string>;
  }) => Promise<BuildResult>;
  dockerRun: (a: {
    image: string;
    name: string;
    hostPort: number;
    env: Record<string, string>;
    volumes: Record<string, string>;
  }) => Promise<DockerRunResult>;
  router: { register: (slug: string, port: number) => void; port: () => number };
  fetchFn: typeof fetch;
  takenPorts: Set<number>;
  healthTimeoutMs?: number; // default 30000
  healthIntervalMs?: number; // default 2000
}

export interface DeployResult {
  ok: boolean;
  url?: string;
  port?: number;
  containerName?: string;
  imageTag?: string;
  reason?: string;
}

export function allocatePort(taken: Set<number>): number {
  for (let p = 19100; p <= 19999; p++) {
    if (!taken.has(p)) return p;
  }
  throw new Error('no free port in [19100, 19999]');
}

export async function deployArtifact(args: DeployArgs): Promise<DeployResult> {
  const tag = `ultraapp/${args.slug}:${args.version}`;
  const containerName = `ultraapp-${args.slug}-${args.version}`;
  const basePath = `/forge/${args.slug}`;

  const built = await args.dockerBuild({
    tag,
    cwd: args.worktreePath,
    buildArgs: { BASE_PATH: basePath },
  });
  if (!built.ok) return { ok: false, reason: `docker build failed: ${built.error ?? 'unknown'}` };

  let hostPort: number;
  try {
    hostPort = allocatePort(args.takenPorts);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  const run = await args.dockerRun({
    image: tag,
    name: containerName,
    hostPort,
    env: { BASE_PATH: basePath },
    volumes: { [path.join(args.hostDataDir, 'data')]: '/data' },
  });
  if (!run.ok) return { ok: false, reason: `docker run failed: ${run.error ?? 'unknown'}` };

  args.router.register(args.slug, hostPort);

  const ok = await waitForHealth({
    url: `http://localhost:${args.router.port()}/forge/${args.slug}/health`,
    fetchFn: args.fetchFn,
    timeoutMs: args.healthTimeoutMs ?? 30000,
    intervalMs: args.healthIntervalMs ?? 2000,
  });
  if (!ok) {
    return {
      ok: false,
      reason: 'health check did not pass within timeout',
      containerName,
      port: hostPort,
      imageTag: tag,
    };
  }

  return {
    ok: true,
    url: `http://localhost:${args.router.port()}/forge/${args.slug}/`,
    port: hostPort,
    containerName,
    imageTag: tag,
  };
}

async function waitForHealth(opts: {
  url: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
  intervalMs: number;
}): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await opts.fetchFn(opts.url);
      if (r.ok) return true;
    } catch {
      /* keep retrying */
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  return false;
}
