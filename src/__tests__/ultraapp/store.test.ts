import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UltraappStore, type RunMode } from '../../ultraapp/store.js';
import { makeEmptySpec } from '../../ultraapp/spec.js';

describe('UltraappStore', () => {
  let tmpRoot: string;
  let store: UltraappStore;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ultraapp-store-'));
    store = new UltraappStore(tmpRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('createRun produces a directory with state.json and spec.json', async () => {
    const id = await store.createRun();
    const dir = path.join(tmpRoot, id);
    expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'spec.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'examples'))).toBe(true);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    expect(state.mode).toBe('interview');
  });

  it('listRuns returns created runs sorted by createdAt desc', async () => {
    const a = await store.createRun();
    await new Promise((r) => setTimeout(r, 10));
    const b = await store.createRun();
    const list = await store.listRuns();
    expect(list.map((r) => r.runId)).toEqual([b, a]);
  });

  it('writeSpec persists and reads back the spec; appends to history', async () => {
    const id = await store.createRun();
    const spec = makeEmptySpec(id);
    spec.meta.name = 'demo';
    await store.writeSpec(id, spec);
    const back = await store.readSpec(id);
    expect(back.meta.name).toBe('demo');
    const history = await store.readSpecHistory(id);
    expect(history.length).toBe(1);
    expect(history[0].spec.meta.name).toBe('demo');
  });

  it('rejects writeSpec when validation fails', async () => {
    const id = await store.createRun();
    const spec = makeEmptySpec(id);
    spec.meta.name = 'BAD NAME';
    await expect(store.writeSpec(id, spec)).rejects.toThrow(/meta\.name/);
  });

  it('appendChat writes a JSONL line and readChat returns parsed entries', async () => {
    const id = await store.createRun();
    await store.appendChat(id, { role: 'assistant', kind: 'question', text: 'hi?' });
    await store.appendChat(id, { role: 'user', kind: 'answer', text: 'hi back' });
    const chat = await store.readChat(id);
    expect(chat.length).toBe(2);
    expect(chat[0].role).toBe('assistant');
    expect(chat[1].text).toBe('hi back');
  });

  it('setMode updates state.json', async () => {
    const id = await store.createRun();
    await store.setMode(id, 'build' as RunMode);
    const state = await store.readState(id);
    expect(state.mode).toBe('build');
  });
});
