import { describe, it, expect, vi } from 'vitest';
import { deployArtifact, allocatePort } from '../../ultraapp/deploy.js';

describe('allocatePort', () => {
  it('returns a port in [19100, 19999] not in use', () => {
    const taken = new Set([19100, 19101, 19102]);
    const p = allocatePort(taken);
    expect(p).toBeGreaterThanOrEqual(19103);
    expect(p).toBeLessThanOrEqual(19999);
    expect(taken.has(p)).toBe(false);
  });
  it('throws if all ports taken', () => {
    const taken = new Set<number>();
    for (let i = 19100; i <= 19999; i++) taken.add(i);
    expect(() => allocatePort(taken)).toThrow(/no free port/i);
  });
});

describe('deployArtifact', () => {
  it('happy path: build, run, register router, returns URL', async () => {
    const dockerBuild = vi.fn().mockResolvedValue({ ok: true, imageId: 'img1' });
    const dockerRun = vi.fn().mockResolvedValue({ ok: true, containerName: 'ultraapp-foo-v1' });
    const router = { register: vi.fn(), port: () => 19000 };
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const r = await deployArtifact({
      runId: 'ua-1',
      version: 'v1',
      worktreePath: '/tmp/wt',
      slug: 'foo',
      hostDataDir: '/tmp/data',
      dockerBuild,
      dockerRun,
      router,
      fetchFn,
      takenPorts: new Set(),
    });
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/localhost:19000\/forge\/foo\//);
    expect(router.register).toHaveBeenCalledWith('foo', expect.any(Number));
    expect(r.containerName).toBe('ultraapp-foo-v1');
    expect(r.imageTag).toBe('ultraapp/foo:v1');
  });

  it('fails when docker build fails', async () => {
    const dockerBuild = vi.fn().mockResolvedValue({ ok: false, error: 'cant pull base' });
    const dockerRun = vi.fn();
    const router = { register: vi.fn(), port: () => 19000 };
    const r = await deployArtifact({
      runId: 'ua-1',
      version: 'v1',
      worktreePath: '/tmp/wt',
      slug: 'foo',
      hostDataDir: '/tmp/data',
      dockerBuild,
      dockerRun,
      router,
      fetchFn: vi.fn(),
      takenPorts: new Set(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/build/);
    expect(dockerRun).not.toHaveBeenCalled();
    expect(router.register).not.toHaveBeenCalled();
  });

  it('fails when docker run fails', async () => {
    const dockerBuild = vi.fn().mockResolvedValue({ ok: true, imageId: 'i' });
    const dockerRun = vi.fn().mockResolvedValue({ ok: false, error: 'address in use' });
    const router = { register: vi.fn(), port: () => 19000 };
    const r = await deployArtifact({
      runId: 'ua-1',
      version: 'v1',
      worktreePath: '/tmp/wt',
      slug: 'foo',
      hostDataDir: '/tmp/data',
      dockerBuild,
      dockerRun,
      router,
      fetchFn: vi.fn(),
      takenPorts: new Set(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/run|address in use/);
    expect(router.register).not.toHaveBeenCalled();
  });

  it('fails when health check times out', async () => {
    const dockerBuild = vi.fn().mockResolvedValue({ ok: true, imageId: 'i' });
    const dockerRun = vi.fn().mockResolvedValue({ ok: true, containerName: 'c' });
    const router = { register: vi.fn(), port: () => 19000 };
    const fetchFn = vi.fn().mockRejectedValue(new Error('econnrefused'));
    const r = await deployArtifact({
      runId: 'ua-1',
      version: 'v1',
      worktreePath: '/tmp/wt',
      slug: 'foo',
      hostDataDir: '/tmp/data',
      dockerBuild,
      dockerRun,
      router,
      fetchFn,
      takenPorts: new Set(),
      healthTimeoutMs: 100,
      healthIntervalMs: 25,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/health/);
  });

  it('skips already-taken ports when allocating', async () => {
    const dockerBuild = vi.fn().mockResolvedValue({ ok: true, imageId: 'i' });
    const dockerRun = vi.fn().mockResolvedValue({ ok: true, containerName: 'c' });
    const router = { register: vi.fn(), port: () => 19000 };
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const taken = new Set<number>();
    for (let p = 19100; p < 19105; p++) taken.add(p);
    const r = await deployArtifact({
      runId: 'ua-1',
      version: 'v1',
      worktreePath: '/tmp/wt',
      slug: 'foo',
      hostDataDir: '/tmp/data',
      dockerBuild,
      dockerRun,
      router,
      fetchFn,
      takenPorts: taken,
    });
    expect(r.ok).toBe(true);
    expect(r.port).toBe(19105);
  });
});
