#!/usr/bin/env node
// Writes dist/index.{js,d.ts} shims that re-export from dist/src/index.js.
// OpenClaw's plugin loader resolves entry points by convention (./dist/index.js)
// rather than reading package.json#main, so this shim lets the same package
// satisfy both Node module resolution (via package.json#main) and OpenClaw.
// See https://github.com/Enderfga/claw-orchestrator/issues/57
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');

if (!existsSync(resolve(dist, 'src', 'index.js'))) {
  console.error('[postbuild] dist/src/index.js not found — did tsc run?');
  process.exit(1);
}

writeFileSync(resolve(dist, 'index.js'), "export * from './src/index.js';\n");
writeFileSync(resolve(dist, 'index.d.ts'), "export * from './src/index.js';\n");
console.log('[postbuild] wrote dist/index.js and dist/index.d.ts shims');
