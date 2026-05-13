import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyUnifiedDiff } from '../../ultraapp/diff-apply.js';

describe('applyUnifiedDiff', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-diff-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('applies a simple modify hunk', () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello\nworld\n');
    const diff = `--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,2 @@
 hello
-world
+universe
`;
    const r = applyUnifiedDiff(diff, tmp);
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8')).toBe('hello\nuniverse\n');
  });

  it('creates a new file (--- /dev/null)', () => {
    const diff = `--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+line1
+line2
`;
    const r = applyUnifiedDiff(diff, tmp);
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'new.txt'), 'utf8')).toBe('line1\nline2\n');
  });

  it('deletes a file (+++ /dev/null)', () => {
    fs.writeFileSync(path.join(tmp, 'gone.txt'), 'bye\n');
    const diff = `--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`;
    const r = applyUnifiedDiff(diff, tmp);
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'gone.txt'))).toBe(false);
  });

  it('reports conflict when context lines do not match', () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'completely different\n');
    const diff = `--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-hello
+goodbye
`;
    const r = applyUnifiedDiff(diff, tmp);
    expect(r.ok).toBe(false);
    expect(r.conflicts!.length).toBeGreaterThan(0);
  });

  it('applies a multi-file diff', () => {
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'a1\n');
    fs.writeFileSync(path.join(tmp, 'b.txt'), 'b1\n');
    const diff = `--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-a1
+a2
--- a/b.txt
+++ b/b.txt
@@ -1,1 +1,1 @@
-b1
+b2
`;
    const r = applyUnifiedDiff(diff, tmp);
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'a.txt'), 'utf8')).toBe('a2\n');
    expect(fs.readFileSync(path.join(tmp, 'b.txt'), 'utf8')).toBe('b2\n');
  });

  it('creates parent directories when patching a nested new file', () => {
    const diff = `--- /dev/null
+++ b/sub/dir/x.txt
@@ -0,0 +1,1 @@
+nested
`;
    const r = applyUnifiedDiff(diff, tmp);
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(tmp, 'sub', 'dir', 'x.txt'), 'utf8')).toBe('nested\n');
  });
});
