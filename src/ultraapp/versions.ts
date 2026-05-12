/**
 * Version snapshot + swap mechanics.
 *
 * Each successful patcher / spec-delta / structural-rerun bumps a version.
 * Versions live under `<runDir>/versions/v1/`, `v2/`, ..., each with their
 * own `artifact.json` carrying worktreePath + (optionally) deploy info.
 *
 * `swapVersion` atomically retargets the router: deregister current slug,
 * stop current container, start new container, register slug to new port.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DeployInfoLite {
  url: string;
  port: number;
  containerName: string;
  imageTag: string;
}

export interface VersionEntry {
  version: string;
  worktreePath: string;
  builtAt: string;
  source?: string;
  deploy?: DeployInfoLite;
}

export function listVersions(versionsDir: string): VersionEntry[] {
  if (!fs.existsSync(versionsDir)) return [];
  const out: VersionEntry[] = [];
  for (const v of fs.readdirSync(versionsDir)) {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(versionsDir, v, 'artifact.json'), 'utf8')) as Omit<
        VersionEntry,
        'version'
      >;
      out.push({ version: v, ...a });
    } catch {
      /* skip non-version dirs */
    }
  }
  out.sort((a, b) => parseVersionNumber(a.version) - parseVersionNumber(b.version));
  return out;
}

function parseVersionNumber(version: string): number {
  const m = /^v(\d+)$/.exec(version);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export function snapshotVersion(versionsDir: string, args: { worktreePath: string; source: string }): string {
  fs.mkdirSync(versionsDir, { recursive: true });
  const existing = listVersions(versionsDir);
  const next = `v${existing.length + 1}`;
  const dir = path.join(versionsDir, next);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'artifact.json'),
    JSON.stringify(
      {
        worktreePath: args.worktreePath,
        builtAt: new Date().toISOString(),
        source: args.source,
      },
      null,
      2,
    ),
  );
  return next;
}

export interface SwapArgs {
  versionsDir: string;
  fromVersion: string;
  toVersion: string;
  slug: string;
  router: { register: (slug: string, port: number) => void; deregister: (slug: string) => void };
  startContainer: (containerName: string) => Promise<{ ok: boolean; error?: string }>;
  stopContainer: (containerName: string) => Promise<{ ok: boolean; error?: string }>;
}

export async function swapVersion(args: SwapArgs): Promise<{ ok: boolean; error?: string }> {
  const versions = listVersions(args.versionsDir);
  const from = versions.find((v) => v.version === args.fromVersion);
  const to = versions.find((v) => v.version === args.toVersion);
  if (!to?.deploy) {
    return { ok: false, error: `target version ${args.toVersion} has no deploy info` };
  }
  args.router.deregister(args.slug);
  if (from?.deploy) {
    await args.stopContainer(from.deploy.containerName).catch(() => {
      /* best effort */
    });
  }
  const r = await args.startContainer(to.deploy.containerName);
  if (!r.ok) return { ok: false, error: r.error };
  args.router.register(args.slug, to.deploy.port);
  return { ok: true };
}
