import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { snapshotVersion, listVersions, swapVersion } from '../../ultraapp/versions.js';

function makeArtifact(dir: string, deploy?: object): void {
  fs.writeFileSync(
    path.join(dir, 'artifact.json'),
    JSON.stringify({
      worktreePath: path.join(dir, 'codebase'),
      builtAt: '2026-05-12T00:00:00Z',
      ...(deploy ? { deploy } : {}),
    }),
  );
}

describe('versions', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-ver-'));
    fs.mkdirSync(path.join(tmp, 'v1'));
    makeArtifact(path.join(tmp, 'v1'), {
      url: 'http://localhost:19000/forge/foo/',
      port: 19101,
      containerName: 'ultraapp-foo-v1',
      imageTag: 'ultraapp/foo:v1',
    });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('listVersions returns versions sorted ascending', () => {
    fs.mkdirSync(path.join(tmp, 'v2'));
    makeArtifact(path.join(tmp, 'v2'));
    fs.mkdirSync(path.join(tmp, 'v10'));
    makeArtifact(path.join(tmp, 'v10'));
    const v = listVersions(tmp);
    expect(v.map((x) => x.version)).toEqual(['v1', 'v2', 'v10']);
  });

  it('snapshotVersion creates next vN+1 with source tag', () => {
    const next = snapshotVersion(tmp, { worktreePath: '/tmp/wt-v2', source: 'patcher' });
    expect(next).toBe('v2');
    const a = JSON.parse(fs.readFileSync(path.join(tmp, 'v2', 'artifact.json'), 'utf8'));
    expect(a.source).toBe('patcher');
    expect(a.worktreePath).toBe('/tmp/wt-v2');
  });

  it('listVersions returns [] for missing dir', () => {
    expect(listVersions(path.join(tmp, 'nonexistent'))).toEqual([]);
  });

  it('swapVersion stops old, starts new, updates router', async () => {
    fs.mkdirSync(path.join(tmp, 'v2'));
    makeArtifact(path.join(tmp, 'v2'), {
      url: 'http://localhost:19000/forge/foo/',
      port: 19102,
      containerName: 'ultraapp-foo-v2',
      imageTag: 'ultraapp/foo:v2',
    });
    const router = { register: vi.fn(), deregister: vi.fn() };
    const startContainer = vi.fn().mockResolvedValue({ ok: true });
    const stopContainer = vi.fn().mockResolvedValue({ ok: true });
    const r = await swapVersion({
      versionsDir: tmp,
      fromVersion: 'v1',
      toVersion: 'v2',
      slug: 'foo',
      router,
      startContainer,
      stopContainer,
    });
    expect(r.ok).toBe(true);
    expect(router.deregister).toHaveBeenCalledWith('foo');
    expect(stopContainer).toHaveBeenCalledWith('ultraapp-foo-v1');
    expect(startContainer).toHaveBeenCalledWith('ultraapp-foo-v2');
    expect(router.register).toHaveBeenCalledWith('foo', 19102);
  });

  it('swapVersion fails if target has no deploy info', async () => {
    fs.mkdirSync(path.join(tmp, 'v2'));
    makeArtifact(path.join(tmp, 'v2')); // no deploy
    const r = await swapVersion({
      versionsDir: tmp,
      fromVersion: 'v1',
      toVersion: 'v2',
      slug: 'foo',
      router: { register: vi.fn(), deregister: vi.fn() },
      startContainer: vi.fn(),
      stopContainer: vi.fn(),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no deploy info/);
  });

  it('swapVersion fails if startContainer fails', async () => {
    fs.mkdirSync(path.join(tmp, 'v2'));
    makeArtifact(path.join(tmp, 'v2'), {
      url: 'http://localhost:19000/forge/foo/',
      port: 19102,
      containerName: 'ultraapp-foo-v2',
      imageTag: 'ultraapp/foo:v2',
    });
    const r = await swapVersion({
      versionsDir: tmp,
      fromVersion: 'v1',
      toVersion: 'v2',
      slug: 'foo',
      router: { register: vi.fn(), deregister: vi.fn() },
      startContainer: vi.fn().mockResolvedValue({ ok: false, error: 'no such container' }),
      stopContainer: vi.fn().mockResolvedValue({ ok: true }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no such container/);
  });
});
