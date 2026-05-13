/**
 * Minimal unified-diff applier — wraps the well-tested `diff` npm package
 * (BSD-2). Used by the patcher for cosmetic post-deploy changes.
 *
 * Handles multi-file diffs, --- /dev/null create, +++ /dev/null delete,
 * and reports per-file conflicts when context lines don't match.
 */

import * as Diff from 'diff';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ApplyResult {
  ok: boolean;
  conflicts?: Array<{ file: string; reason: string }>;
}

export function applyUnifiedDiff(diff: string, cwd: string): ApplyResult {
  const patches = Diff.parsePatch(diff);
  const conflicts: Array<{ file: string; reason: string }> = [];
  for (const patch of patches) {
    const oldFile = patch.oldFileName ?? '';
    const newFile = patch.newFileName ?? '';
    const isCreate = oldFile === '/dev/null';
    const isDelete = newFile === '/dev/null';
    const targetRel = (isDelete ? oldFile : newFile).replace(/^[ab]\//, '');
    const target = path.join(cwd, targetRel);

    if (isDelete) {
      try {
        fs.unlinkSync(target);
      } catch (e) {
        conflicts.push({ file: targetRel, reason: (e as Error).message });
      }
      continue;
    }

    let original: string;
    try {
      original = isCreate ? '' : fs.readFileSync(target, 'utf8');
    } catch (e) {
      conflicts.push({ file: targetRel, reason: `read failed: ${(e as Error).message}` });
      continue;
    }
    const next = Diff.applyPatch(original, patch);
    if (next === false) {
      conflicts.push({ file: targetRel, reason: 'context mismatch' });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
  }
  return conflicts.length === 0 ? { ok: true } : { ok: false, conflicts };
}
