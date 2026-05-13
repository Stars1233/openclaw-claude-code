import { describe, it, expect, vi } from 'vitest';
import { UltraappBuildQueue } from '../../ultraapp/build.js';
import type { BuildEvent } from '../../ultraapp/build-events.js';

describe('UltraappBuildQueue', () => {
  it('runs queued builds serially', async () => {
    const order: string[] = [];
    const worker = vi.fn().mockImplementation(async (runId: string) => {
      order.push(`start ${runId}`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`end ${runId}`);
    });
    const q = new UltraappBuildQueue({ worker });
    await Promise.all([q.enqueue('a'), q.enqueue('b'), q.enqueue('c')]);
    await q.idle();
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('reports queue position', async () => {
    const releases: Array<() => void> = [];
    const worker = vi.fn().mockImplementation(() => new Promise<void>((r) => releases.push(r)));
    const q = new UltraappBuildQueue({ worker });
    await q.enqueue('a');
    await q.enqueue('b');
    await q.enqueue('c');
    // a is in flight (position 0), b/c pending
    expect(q.position('a')).toBe(0);
    expect(q.position('b')).toBe(1);
    expect(q.position('c')).toBe(2);
    // Release all in order so the queue can drain
    while (releases.length || q.position('a') === 0) {
      const r = releases.shift();
      if (!r) {
        await new Promise((res) => setTimeout(res, 5));
        continue;
      }
      r();
      await new Promise((res) => setTimeout(res, 5));
    }
    await q.idle();
  });

  it('emits queued event with position when enqueued behind another build', async () => {
    const releases: Array<() => void> = [];
    const worker = vi.fn().mockImplementation(() => new Promise<void>((r) => releases.push(r)));
    const events: BuildEvent[] = [];
    const q = new UltraappBuildQueue({ worker });
    q.subscribe((e) => events.push(e));
    await q.enqueue('a');
    await q.enqueue('b');
    expect(events.find((e) => e.type === 'queued' && e.runId === 'b')).toBeTruthy();
    while (releases.length) releases.shift()!();
    // Drain
    for (let i = 0; i < 10 && releases.length === 0; i++) {
      await new Promise((res) => setTimeout(res, 5));
    }
    while (releases.length) releases.shift()!();
    await q.idle();
  });

  it('cancel removes pending', async () => {
    const releases: Array<() => void> = [];
    const worker = vi.fn().mockImplementation(() => new Promise<void>((r) => releases.push(r)));
    const q = new UltraappBuildQueue({ worker });
    await q.enqueue('a');
    await q.enqueue('b');
    q.cancel('b');
    expect(q.position('b')).toBe(-1);
    while (releases.length) releases.shift()!();
    await q.idle();
    expect(worker).toHaveBeenCalledTimes(1);
  });

  it('emits build-failed when worker throws', async () => {
    const worker = vi.fn().mockRejectedValue(new Error('boom'));
    const events: BuildEvent[] = [];
    const q = new UltraappBuildQueue({ worker });
    q.subscribe((e) => events.push(e));
    await q.enqueue('a');
    await q.idle();
    const failed = events.find((e) => e.type === 'build-failed');
    expect(failed).toBeTruthy();
    expect(failed!.type === 'build-failed' && failed.reason).toMatch(/boom/);
  });

  it('subscribe returns unsubscribe fn', async () => {
    const events: BuildEvent[] = [];
    const q = new UltraappBuildQueue({ worker: vi.fn().mockResolvedValue(undefined) });
    const off = q.subscribe((e) => events.push(e));
    off();
    await q.enqueue('a');
    await q.idle();
    expect(events).toEqual([]);
  });
});
