import { describe, it, expect, vi } from 'vitest';
import {
  findColdContainers,
  startContainerAndRegister,
  stopContainerAndDeregister,
  deleteContainerAndDeregister,
  type ContainerLastAccess,
} from '../../ultraapp/lifecycle.js';

const NOW = new Date('2026-05-12T00:00:00Z').getTime();

describe('findColdContainers', () => {
  it('returns containers untouched for >threshold days', () => {
    const data: ContainerLastAccess[] = [
      { containerName: 'a', lastAccess: NOW - 31 * 86400000 },
      { containerName: 'b', lastAccess: NOW - 5 * 86400000 },
      { containerName: 'c', lastAccess: NOW - 100 * 86400000 },
    ];
    const cold = findColdContainers(data, NOW, 30);
    expect(cold.map((c) => c.containerName).sort()).toEqual(['a', 'c']);
  });

  it('returns [] when nothing is cold', () => {
    const data: ContainerLastAccess[] = [{ containerName: 'a', lastAccess: NOW - 5 * 86400000 }];
    expect(findColdContainers(data, NOW, 30)).toEqual([]);
  });

  it('boundary: exactly threshold days is NOT cold', () => {
    const data: ContainerLastAccess[] = [
      { containerName: 'edge', lastAccess: NOW - 30 * 86400000 },
    ];
    expect(findColdContainers(data, NOW, 30)).toEqual([]);
  });
});

function fakeRouter() {
  const calls: Array<['register' | 'deregister', string, number?]> = [];
  return {
    register: (slug: string, port: number) => {
      calls.push(['register', slug, port]);
    },
    deregister: (slug: string) => {
      calls.push(['deregister', slug]);
    },
    list: () => [],
    port: () => 19000,
    calls,
  };
}

describe('startContainerAndRegister', () => {
  it('starts container then registers slug→port on success', async () => {
    const router = fakeRouter();
    const start = vi.fn().mockResolvedValue({ ok: true });
    const r = await startContainerAndRegister(
      'cont-a',
      'foo',
      19101,
      router as never,
      { dockerStartFn: start },
    );
    expect(r.ok).toBe(true);
    expect(start).toHaveBeenCalledWith('cont-a');
    expect(router.calls).toEqual([['register', 'foo', 19101]]);
  });

  it('does not register when start fails', async () => {
    const router = fakeRouter();
    const start = vi.fn().mockResolvedValue({ ok: false, error: 'no such container' });
    const r = await startContainerAndRegister(
      'cont-a',
      'foo',
      19101,
      router as never,
      { dockerStartFn: start },
    );
    expect(r.ok).toBe(false);
    expect(router.calls).toEqual([]);
  });
});

describe('stopContainerAndDeregister', () => {
  it('deregisters slug then stops container', async () => {
    const router = fakeRouter();
    const stop = vi.fn().mockResolvedValue({ ok: true });
    const r = await stopContainerAndDeregister('cont-a', 'foo', router as never, {
      dockerStopFn: stop,
    });
    expect(r.ok).toBe(true);
    expect(stop).toHaveBeenCalledWith('cont-a');
    expect(router.calls).toEqual([['deregister', 'foo']]);
  });
});

describe('deleteContainerAndDeregister', () => {
  it('deregisters slug then removes container', async () => {
    const router = fakeRouter();
    const rm = vi.fn().mockResolvedValue({ ok: true });
    const r = await deleteContainerAndDeregister('cont-a', 'foo', router as never, {
      dockerRmFn: rm,
    });
    expect(r.ok).toBe(true);
    expect(rm).toHaveBeenCalledWith('cont-a');
    expect(router.calls).toEqual([['deregister', 'foo']]);
  });
});
