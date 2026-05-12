/**
 * Container lifecycle helpers — start / stop / delete with router (de)registration,
 * plus cold-eligibility logic for the periodic GC sweeper.
 *
 * The actual GC sweeper itself is wired in v0.4+ (it needs lastAccess
 * accounting from the router, which is not present in v0.3). This module
 * only exposes the pure predicate findColdContainers.
 */

import { dockerStart, dockerStop, dockerRm } from './docker.js';
import type { UltraappRouter } from './router.js';

export interface ContainerLastAccess {
  containerName: string;
  lastAccess: number; // ms epoch
  slug?: string;
  port?: number;
}

export function findColdContainers(items: ContainerLastAccess[], now: number, days: number): ContainerLastAccess[] {
  const cutoff = now - days * 86400000;
  return items.filter((i) => i.lastAccess < cutoff);
}

export interface StartOpts {
  dockerStartFn?: typeof dockerStart;
}

export async function startContainerAndRegister(
  containerName: string,
  slug: string,
  port: number,
  router: UltraappRouter,
  opts: StartOpts = {},
): Promise<{ ok: boolean; error?: string }> {
  const fn = opts.dockerStartFn ?? dockerStart;
  const r = await fn(containerName);
  if (r.ok) router.register(slug, port);
  return r;
}

export interface StopOpts {
  dockerStopFn?: typeof dockerStop;
}

export async function stopContainerAndDeregister(
  containerName: string,
  slug: string,
  router: UltraappRouter,
  opts: StopOpts = {},
): Promise<{ ok: boolean; error?: string }> {
  const fn = opts.dockerStopFn ?? dockerStop;
  router.deregister(slug);
  return fn(containerName);
}

export interface DeleteOpts {
  dockerRmFn?: typeof dockerRm;
}

export async function deleteContainerAndDeregister(
  containerName: string,
  slug: string,
  router: UltraappRouter,
  opts: DeleteOpts = {},
): Promise<{ ok: boolean; error?: string }> {
  const fn = opts.dockerRmFn ?? dockerRm;
  router.deregister(slug);
  return fn(containerName);
}
