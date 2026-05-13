import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listCouncilsFromDisk } from '../session-manager.js';

describe('listCouncilsFromDisk', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-disk-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('parses transcripts with explicit **ID** header', () => {
    const file = path.join(tmpDir, 'council-2026-05-13T05-15-40.md');
    fs.writeFileSync(
      file,
      [
        '# Council Transcript',
        '',
        '- **ID**: abc-123',
        '- **Time**: 2026-05-13T05:15:40.582Z',
        '- **Task**: build the thing',
        '- **Status**: consensus',
        '',
        '---',
        '',
        '## Round 1',
        'agent-A: ...',
      ].join('\n'),
    );
    const results = listCouncilsFromDisk(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('abc-123');
    expect(results[0].task).toBe('build the thing');
    expect(results[0].status).toBe('consensus');
    expect(results[0].startTime).toBe('2026-05-13T05:15:40.582Z');
  });

  it('falls back to filename-derived id when **ID** header is missing (legacy transcripts)', () => {
    const file = path.join(tmpDir, 'council-2026-04-03T03-06-08.md');
    fs.writeFileSync(
      file,
      [
        '# Council Transcript',
        '',
        '- **Time**: 2026-04-03T03:06:08.000Z',
        '- **Task**: legacy task',
        '- **Status**: max_rounds',
      ].join('\n'),
    );
    const results = listCouncilsFromDisk(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('council-2026-04-03T03-06-08');
    expect(results[0].task).toBe('legacy task');
  });

  it('returns [] when the log dir does not exist', () => {
    expect(listCouncilsFromDisk(path.join(tmpDir, 'missing'))).toEqual([]);
  });

  it('skips files that are not council transcripts', () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.md'), 'random content');
    fs.writeFileSync(path.join(tmpDir, 'README'), 'not markdown');
    expect(listCouncilsFromDisk(tmpDir)).toEqual([]);
  });
});
