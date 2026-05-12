import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateLocalPath, ingestUpload, extractMetadata } from '../../ultraapp/files.js';

describe('validateLocalPath', () => {
  const fakeHome = '/Users/alice';
  const allow = [fakeHome, '/tmp'];

  it('accepts a path under HOME', () => {
    expect(() =>
      validateLocalPath('/Users/alice/Movies/raw.mp4', { allow }),
    ).not.toThrow();
  });

  it('accepts a path under /tmp', () => {
    expect(() => validateLocalPath('/tmp/foo.bin', { allow })).not.toThrow();
  });

  it('rejects /etc paths', () => {
    expect(() => validateLocalPath('/etc/passwd', { allow })).toThrow(/outside sandbox/i);
  });

  it('rejects paths containing /. segments (~/.ssh)', () => {
    expect(() =>
      validateLocalPath('/Users/alice/.ssh/id_rsa', { allow }),
    ).toThrow(/dotfile/i);
  });

  it('rejects relative paths', () => {
    expect(() => validateLocalPath('foo/bar', { allow })).toThrow(/absolute/i);
  });

  it('rejects symlinks (via lstat injection)', () => {
    const lstat = vi.fn().mockReturnValue({ isSymbolicLink: () => true });
    expect(() =>
      validateLocalPath('/Users/alice/foo', { allow, lstat }),
    ).toThrow(/symlink/i);
  });
});

describe('ingestUpload', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-files-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('writes the upload to examplesDir and returns a stable ref', async () => {
    const ref = await ingestUpload(tmp, 'sample.mp4', Buffer.from('hello'));
    expect(ref.startsWith(tmp)).toBe(true);
    expect(fs.readFileSync(ref, 'utf8')).toBe('hello');
  });

  it('uses uuid prefix to avoid collisions', async () => {
    const a = await ingestUpload(tmp, 'same.txt', Buffer.from('a'));
    const b = await ingestUpload(tmp, 'same.txt', Buffer.from('b'));
    expect(a).not.toBe(b);
  });

  it('rejects oversize buffers', async () => {
    const big = Buffer.alloc(101 * 1024 * 1024);
    await expect(ingestUpload(tmp, 'x', big)).rejects.toThrow(/too large/i);
  });
});

describe('extractMetadata', () => {
  it('returns shell tool output when binary present', async () => {
    const fakeRunner = vi.fn(async (cmd: string) => {
      if (cmd === 'file')
        return { ok: true, stdout: 'sample.mp4: ISO Media, MP4 Base Media v1' };
      if (cmd === 'ffprobe') return { ok: true, stdout: '{"format":{"duration":"180"}}' };
      return { ok: false, stdout: '' };
    });
    const meta = await extractMetadata('/tmp/sample.mp4', { runner: fakeRunner });
    expect(meta.fileType).toMatch(/MP4/);
    expect(meta.ffprobe).toEqual({ format: { duration: '180' } });
  });

  it('skips ffprobe gracefully when missing', async () => {
    const fakeRunner = vi.fn(async (cmd: string) => {
      if (cmd === 'file') return { ok: true, stdout: 'foo.txt: ASCII text' };
      return { ok: false, stdout: '' };
    });
    const meta = await extractMetadata('/tmp/foo.txt', { runner: fakeRunner });
    expect(meta.fileType).toMatch(/ASCII/);
    expect(meta.ffprobe).toBeUndefined();
  });
});
