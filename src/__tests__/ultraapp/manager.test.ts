import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UltraappManager } from '../../ultraapp/manager.js';
import { UltraappStore } from '../../ultraapp/store.js';

interface FakeSession {
  send: ReturnType<typeof vi.fn>;
}

function fakeSessionManager(reply: string) {
  const session: FakeSession = {
    send: vi.fn().mockResolvedValue({ output: reply, requestId: 'r' }),
  };
  return {
    startSession: vi.fn().mockResolvedValue({ name: 'ultraapp-r1' }),
    sendMessage: (_name: string, msg: string) => session.send(msg),
    stopSession: vi.fn().mockResolvedValue(undefined),
    _session: session,
  };
}

function questionReply(): string {
  return '```question\n{"question":"hi","options":[{"label":"a","value":"a"}],"recommended":"a","freeformAccepted":true}\n```';
}

describe('UltraappManager', () => {
  let tmp: string;
  let store: UltraappStore;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-mgr-'));
    store = new UltraappStore(tmp);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('createRun returns runId, persists initial state, starts session', async () => {
    const sm = fakeSessionManager(questionReply());
    const mgr = new UltraappManager({ store, sessionManager: sm as never });
    const id = await mgr.createRun();
    expect(id.startsWith('ua-')).toBe(true);
    expect(sm.startSession).toHaveBeenCalled();
    const state = await store.readState(id);
    expect(state.mode).toBe('interview');
  });

  it('createRun emits initial question via subscribe', async () => {
    const sm = fakeSessionManager(questionReply());
    const mgr = new UltraappManager({ store, sessionManager: sm as never });
    const events: unknown[] = [];
    // Subscribe BEFORE createRun's background driveTurn fires
    const id = await mgr.createRun();
    mgr.subscribe(id, (ev) => events.push(ev));
    // Allow driveTurn microtask + send to complete
    await new Promise((r) => setTimeout(r, 50));
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('question');
  });

  it('submitAnswer feeds the answer back into the session and emits next question', async () => {
    const replies = [
      '```question\n{"question":"q1","options":[{"label":"a","value":"a"}],"recommended":"a","freeformAccepted":true}\n```',
      '```question\n{"question":"q2","options":[{"label":"b","value":"b"}],"recommended":"b","freeformAccepted":true}\n```',
    ];
    let i = 0;
    const sm = {
      startSession: vi.fn().mockResolvedValue({ name: 'ultraapp-r1' }),
      sendMessage: vi.fn().mockImplementation(async () => ({ output: replies[i++], requestId: `r${i}` })),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };
    const mgr = new UltraappManager({ store, sessionManager: sm as never });
    const id = await mgr.createRun();
    await new Promise((r) => setTimeout(r, 50));
    await mgr.submitAnswer(id, { value: 'a' });
    await new Promise((r) => setTimeout(r, 50));
    const chat = await store.readChat(id);
    const questions = chat.filter((c) => c.kind === 'question');
    expect(questions.length).toBe(2);
  });

  it('applySpecEdit updates spec and emits spec-updated event', async () => {
    const sm = fakeSessionManager(questionReply());
    const mgr = new UltraappManager({ store, sessionManager: sm as never });
    const id = await mgr.createRun();
    const events: unknown[] = [];
    mgr.subscribe(id, (ev) => events.push(ev));
    await mgr.applySpecEdit(id, [{ op: 'replace', path: '/meta/name', value: 'edited' }]);
    const spec = await store.readSpec(id);
    expect(spec.meta.name).toBe('edited');
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('spec-updated');
  });
});
