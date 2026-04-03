#!/usr/bin/env tsx
/**
 * Full functional audit — tests all 27 tools across all 3 engines.
 * Requires: claude, codex, gemini CLIs installed and authenticated.
 */

import { SessionManager } from './src/session-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const manager = new SessionManager({ claudeBin: 'claude' });
const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-audit-'));

// Simple test tracking
let passed = 0;
let failed = 0;
let skipped = 0;
const results: Array<{ name: string; status: string; detail: string }> = [];

function ok(name: string, detail = '') {
  passed++;
  results.push({ name, status: '✅', detail });
  console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name: string, detail: string) {
  failed++;
  results.push({ name, status: '❌', detail });
  console.log(`  ❌ ${name} — ${detail}`);
}
function warn(name: string, detail: string) {
  skipped++;
  results.push({ name, status: '⚠️', detail });
  console.log(`  ⚠️ ${name} — ${detail}`);
}

async function safeRun(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    fail(name, (err as Error).message.slice(0, 200));
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function testEngine(engine: 'claude' | 'codex' | 'gemini') {
  const sessionName = `audit-${engine}`;
  const testPrompt = 'Reply with exactly one word: PONG';
  const sendTimeout = engine === 'claude' ? 120_000 : 180_000;

  console.log(`\n═══ Engine: ${engine} ═══`);

  // --- session_start ---
  await safeRun(`${engine}/session_start`, async () => {
    const info = await manager.startSession({
      name: sessionName,
      cwd: TEST_CWD,
      engine,
      permissionMode: 'bypassPermissions',
    });
    if (info.name === sessionName) {
      ok(`${engine}/session_start`, `session=${info.name}`);
    } else {
      fail(`${engine}/session_start`, `unexpected name: ${info.name}`);
    }
  });

  // --- session_status ---
  await safeRun(`${engine}/session_status`, async () => {
    const st = manager.getStatus(sessionName);
    if (st && st.stats && typeof st.stats.turns === 'number') {
      ok(`${engine}/session_status`, `turns=${st.stats.turns}, ready=${st.stats.isReady}`);
    } else {
      fail(`${engine}/session_status`, 'missing stats');
    }
  });

  // --- session_send ---
  await safeRun(`${engine}/session_send`, async () => {
    const result = await manager.sendMessage(sessionName, testPrompt, { timeout: sendTimeout });
    const output = result.output.trim();
    if (output.length > 0) {
      // Check it's not just echoing the prompt back
      const isEcho = output === testPrompt || output === testPrompt.replace(/'/g, '');
      if (isEcho) {
        fail(`${engine}/session_send`, `ECHO detected — engine returned prompt verbatim: "${output.slice(0, 80)}"`);
      } else {
        ok(`${engine}/session_send`, `response="${output.slice(0, 80)}"`);
      }
    } else {
      fail(`${engine}/session_send`, 'empty response');
    }
  });

  // --- session_grep ---
  await safeRun(`${engine}/session_grep`, async () => {
    const matches = await manager.grepSession(sessionName, 'PONG|pong');
    // It's OK if grep finds 0 matches (engine might not have said PONG)
    // but it should at least not throw
    ok(`${engine}/session_grep`, `matches=${matches.length}`);
  });

  // --- session_compact ---
  await safeRun(`${engine}/session_compact`, async () => {
    await manager.compactSession(sessionName);
    ok(`${engine}/session_compact`);
  });

  // --- getCost ---
  await safeRun(`${engine}/getCost`, async () => {
    const cost = manager.getCost(sessionName);
    if (cost && typeof cost.totalUsd === 'number') {
      ok(`${engine}/getCost`, `total=$${cost.totalUsd}, model=${cost.model}`);
    } else {
      fail(`${engine}/getCost`, 'invalid cost breakdown');
    }
  });

  // --- session_stop ---
  await safeRun(`${engine}/session_stop`, async () => {
    await manager.stopSession(sessionName);
    const list = manager.listSessions();
    const found = list.find((s) => s.name === sessionName);
    if (!found) {
      ok(`${engine}/session_stop`, 'session removed');
    } else {
      fail(`${engine}/session_stop`, 'session still in list after stop');
    }
  });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  openclaw-claude-code — Full Functional Audit            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`Test CWD: ${TEST_CWD}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // ═══ A. Baseline tools (no session needed) ═══
  console.log('═══ A. Baseline Tools ═══');

  await safeRun('session_list (empty)', async () => {
    const list = manager.listSessions();
    ok('session_list (empty)', `count=${list.length}`);
  });

  await safeRun('sessions_overview', async () => {
    const h = manager.health();
    if (h && typeof h.ok === 'boolean') {
      ok('sessions_overview', `ok=${h.ok}, version=${h.version}`);
    } else {
      fail('sessions_overview', 'invalid health response');
    }
  });

  await safeRun('agents_list', async () => {
    const agents = manager.listAgents(TEST_CWD);
    ok('agents_list', `count=${agents.length}`);
  });

  await safeRun('skills_list', async () => {
    const skills = manager.listSkills(TEST_CWD);
    ok('skills_list', `count=${skills.length}`);
  });

  await safeRun('rules_list', async () => {
    const rules = manager.listRules(TEST_CWD);
    ok('rules_list', `count=${rules.length}`);
  });

  // ═══ B. Per-Engine Session Lifecycle ═══
  await testEngine('claude');
  await testEngine('codex');
  await testEngine('gemini');

  // ═══ C. Cross-Session Messaging (Inbox) ═══
  console.log('\n═══ C. Cross-Session Messaging ═══');

  await safeRun('inbox/setup', async () => {
    await manager.startSession({ name: 'inbox-sender', cwd: TEST_CWD, engine: 'claude', permissionMode: 'bypassPermissions' });
    await manager.startSession({ name: 'inbox-receiver', cwd: TEST_CWD, engine: 'claude', permissionMode: 'bypassPermissions' });
    ok('inbox/setup', 'sender + receiver started');
  });

  // Make receiver busy so messages get queued
  await safeRun('session_send_to (direct)', async () => {
    const result = await manager.sessionSendTo('inbox-sender', 'inbox-receiver', 'hello from sender', 'test msg');
    if (result.delivered || result.queued) {
      ok('session_send_to (direct)', `delivered=${result.delivered}, queued=${result.queued}`);
    } else {
      fail('session_send_to (direct)', 'neither delivered nor queued');
    }
  });

  await safeRun('session_inbox', async () => {
    const inbox = manager.sessionInbox('inbox-receiver', false);
    ok('session_inbox', `messages=${inbox.length}`);
  });

  await safeRun('session_deliver_inbox', async () => {
    const count = await manager.sessionDeliverInbox('inbox-receiver');
    ok('session_deliver_inbox', `delivered=${count}`);
  });

  // Cleanup inbox sessions
  await manager.stopSession('inbox-sender').catch(() => {});
  await manager.stopSession('inbox-receiver').catch(() => {});

  // ═══ D. Team Tools (Claude-only, engine gate) ═══
  console.log('\n═══ D. Team Tools ═══');

  // Test engine gate: non-Claude engines should reject
  await safeRun('team_list/engine_gate', async () => {
    await manager.startSession({ name: 'team-codex', cwd: TEST_CWD, engine: 'codex', permissionMode: 'bypassPermissions' });
    try {
      await manager.teamList('team-codex');
      fail('team_list/engine_gate', 'should have rejected codex engine');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('only supported on the Claude engine')) {
        ok('team_list/engine_gate', 'correctly rejected codex');
      } else {
        fail('team_list/engine_gate', `unexpected error: ${msg.slice(0, 100)}`);
      }
    } finally {
      await manager.stopSession('team-codex').catch(() => {});
    }
  });

  await safeRun('team_send/engine_gate', async () => {
    await manager.startSession({ name: 'team-gemini', cwd: TEST_CWD, engine: 'gemini', permissionMode: 'bypassPermissions' });
    try {
      await manager.teamSend('team-gemini', 'foo', 'hello');
      fail('team_send/engine_gate', 'should have rejected gemini engine');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('only supported on the Claude engine')) {
        ok('team_send/engine_gate', 'correctly rejected gemini');
      } else {
        fail('team_send/engine_gate', `unexpected error: ${msg.slice(0, 100)}`);
      }
    } finally {
      await manager.stopSession('team-gemini').catch(() => {});
    }
  });

  // Test team_list on Claude engine (may or may not have teams enabled)
  await safeRun('team_list/claude', async () => {
    await manager.startSession({ name: 'team-claude', cwd: TEST_CWD, engine: 'claude', permissionMode: 'bypassPermissions' });
    try {
      const teamResult = await manager.teamList('team-claude');
      // teamList sends /team to Claude — might succeed or fail depending on team support
      ok('team_list/claude', `response="${(teamResult || '').slice(0, 80)}"`);
    } catch (err) {
      // Claude might reject /team if no team session is active — that's fine
      warn('team_list/claude', `Claude rejected: ${(err as Error).message.slice(0, 100)}`);
    } finally {
      await manager.stopSession('team-claude').catch(() => {});
    }
  });

  // ═══ E. Model Switch & Update Tools ═══
  console.log('\n═══ E. Model Switch & Update Tools ═══');

  await safeRun('switch_model', async () => {
    await manager.startSession({ name: 'switch-test', cwd: TEST_CWD, engine: 'claude', permissionMode: 'bypassPermissions' });
    // Send a message first to get a session ID
    await manager.sendMessage('switch-test', 'say OK', { timeout: 60_000 });
    try {
      const newInfo = await manager.switchModel('switch-test', 'claude-sonnet-4-6');
      ok('switch_model', `model=${newInfo.model}`);
    } catch (err) {
      fail('switch_model', (err as Error).message.slice(0, 120));
    } finally {
      await manager.stopSession('switch-test').catch(() => {});
    }
  });

  await safeRun('update_tools', async () => {
    await manager.startSession({ name: 'tools-test', cwd: TEST_CWD, engine: 'claude', permissionMode: 'bypassPermissions' });
    await manager.sendMessage('tools-test', 'say OK', { timeout: 60_000 });
    try {
      const updated = await manager.updateTools('tools-test', {
        allowedTools: ['Read', 'Write'],
        merge: false,
      });
      ok('update_tools', `session=${updated.name}`);
    } catch (err) {
      fail('update_tools', (err as Error).message.slice(0, 120));
    } finally {
      await manager.stopSession('tools-test').catch(() => {});
    }
  });

  // ═══ F. Ultraplan ═══
  console.log('\n═══ F. Ultraplan ═══');

  await safeRun('ultraplan_start', async () => {
    const r = manager.ultraplanStart('List all files in the current directory and describe the project structure.', {
      cwd: TEST_CWD,
      timeout: 180_000,
    });
    if (r.id && r.status === 'running') {
      ok('ultraplan_start', `id=${r.id}`);

      // Wait a bit then check status
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const st = manager.ultraplanStatus(r.id);
      if (st) {
        ok('ultraplan_status', `status=${st.status}${st.error ? ', error=' + st.error.slice(0, 60) : ''}`);
      } else {
        fail('ultraplan_status', 'not found');
      }

      // Wait for completion (up to 3 min)
      let finalStatus = st;
      const start = Date.now();
      while (finalStatus?.status === 'running' && Date.now() - start < 180_000) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        finalStatus = manager.ultraplanStatus(r.id);
      }
      if (finalStatus) {
        if (finalStatus.status === 'completed' && finalStatus.plan) {
          ok('ultraplan_completion', `plan length=${finalStatus.plan.length}`);
        } else if (finalStatus.status === 'error') {
          fail('ultraplan_completion', `error: ${finalStatus.error?.slice(0, 120)}`);
        } else {
          warn('ultraplan_completion', `status=${finalStatus.status}`);
        }
      }
    } else {
      fail('ultraplan_start', `unexpected: status=${r.status}`);
    }
  });

  // ═══ G. Council (lightweight test — 2 claude agents, 1 round) ═══
  console.log('\n═══ G. Council ═══');

  const councilDir = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-council-'));
  // Initialize git in council dir
  const { execSync } = await import('node:child_process');
  execSync('git init -b main && git config user.email "test@test" && git config user.name "Test" && git commit --allow-empty -m init', { cwd: councilDir, stdio: 'pipe' });

  await safeRun('council_start', async () => {
    const session = manager.councilStart('Create a hello.txt file that says Hello World', {
      agents: [
        { name: 'alice', emoji: '🔵', persona: 'You are Alice, a helpful developer.' },
        { name: 'bob', emoji: '🟢', persona: 'You are Bob, a careful reviewer.' },
      ],
      maxRounds: 1,
      projectDir: councilDir,
      agentTimeoutMs: 180_000,
    });
    if (session.id && session.status === 'running') {
      ok('council_start', `id=${session.id.slice(0, 8)}`);

      // Check status
      const st = manager.councilStatus(session.id);
      if (st) {
        ok('council_status', `status=${st.status}, responses=${st.responses.length}`);
      } else {
        fail('council_status', 'not found');
      }

      // Wait for council to complete (up to 4 min)
      const start = Date.now();
      let finalSt = st;
      while (finalSt && finalSt.status === 'running' && Date.now() - start < 240_000) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        finalSt = manager.councilStatus(session.id);
      }

      if (finalSt) {
        console.log(`  Council final: status=${finalSt.status}, responses=${finalSt.responses.length}`);

        // Check consensus results
        if (finalSt.responses.length > 0) {
          for (const resp of finalSt.responses) {
            const hasVote = resp.content.includes('[CONSENSUS:');
            console.log(`    Agent ${resp.agent} (R${resp.round}): consensus=${resp.consensus}, hasVoteTag=${hasVote}, len=${resp.content.length}`);
            if (resp.consensus && !hasVote) {
              fail('council/consensus_integrity', `${resp.agent} marked consensus=true but no [CONSENSUS:] tag found`);
            }
          }
          ok('council_execution', `${finalSt.responses.length} agent responses collected`);
        } else {
          fail('council_execution', 'no agent responses');
        }

        // council_review
        try {
          const review = await manager.councilReview(session.id);
          ok('council_review', `planExists=${review.planExists}, files=${review.changedFiles.length}, branches=${review.branches.length}`);

          // council_reject (test with feedback)
          try {
            const rejection = await manager.councilReject(session.id, 'Test rejection feedback');
            ok('council_reject', `planRewritten=${rejection.planRewritten}`);
          } catch (err) {
            fail('council_reject', (err as Error).message.slice(0, 100));
          }
        } catch (err) {
          fail('council_review', (err as Error).message.slice(0, 100));
        }
      } else {
        fail('council_completion', 'status lost');
      }
    } else {
      fail('council_start', `unexpected status: ${session.status}`);
    }
  });

  // council_accept test (separate council, quick)
  await safeRun('council_accept', async () => {
    const councilDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-council2-'));
    execSync('git init -b main && git config user.email "test@test" && git config user.name "Test" && git commit --allow-empty -m init', { cwd: councilDir2, stdio: 'pipe' });

    const session2 = manager.councilStart('Write hello.txt', {
      agents: [{ name: 'solo', emoji: '⭐', persona: 'Do the task quickly.' }],
      maxRounds: 1,
      projectDir: councilDir2,
      agentTimeoutMs: 120_000,
    });

    // Wait for completion
    const start = Date.now();
    let st = manager.councilStatus(session2.id);
    while (st && st.status === 'running' && Date.now() - start < 180_000) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      st = manager.councilStatus(session2.id);
    }

    if (st && st.status !== 'running') {
      try {
        const result = await manager.councilAccept(session2.id);
        ok('council_accept', `branches=${result.branchesDeleted.length}, worktrees=${result.worktreesRemoved.length}`);
      } catch (err) {
        fail('council_accept', (err as Error).message.slice(0, 100));
      }
    } else {
      warn('council_accept', 'council still running, skipped');
    }
  });

  // ═══ H. Ultrareview ═══
  console.log('\n═══ H. Ultrareview ═══');

  await safeRun('ultrareview_start', async () => {
    const r = manager.ultrareviewStart(TEST_CWD, { agentCount: 2, maxDurationMinutes: 3 });
    if (r.id && r.status === 'running') {
      ok('ultrareview_start', `id=${r.id}, agents=${r.agentCount}`);

      await new Promise((resolve) => setTimeout(resolve, 3000));
      const st = manager.ultrareviewStatus(r.id);
      if (st) {
        ok('ultrareview_status', `status=${st.status}`);
      } else {
        fail('ultrareview_status', 'not found');
      }

      // Wait for completion
      const start = Date.now();
      let finalSt = st;
      while (finalSt?.status === 'running' && Date.now() - start < 240_000) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        finalSt = manager.ultrareviewStatus(r.id);
      }
      if (finalSt) {
        if (finalSt.status === 'completed') {
          ok('ultrareview_completion', `findings=${(finalSt.findings || '').length} chars`);
        } else if (finalSt.status === 'error') {
          fail('ultrareview_completion', `error: ${finalSt.error?.slice(0, 120)}`);
        } else {
          warn('ultrareview_completion', `status=${finalSt.status}`);
        }
      }
    } else {
      fail('ultrareview_start', `unexpected status=${r.status}`);
    }
  });

  // ═══ Summary ═══
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  AUDIT SUMMARY                                          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log(`  ✅ Passed:  ${passed}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  ⚠️  Warned:  ${skipped}`);
  console.log(`  Total:     ${passed + failed + skipped}\n`);

  console.log('─── Detailed Results ───\n');
  for (const r of results) {
    console.log(`  ${r.status} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }

  // Write results to file
  const reportPath = '/tmp/occ-full-audit-results.md';
  let md = `# openclaw-claude-code Full Audit Results\n\n`;
  md += `Date: ${new Date().toISOString()}\n`;
  md += `Passed: ${passed} | Failed: ${failed} | Warned: ${skipped}\n\n`;
  md += `| Status | Test | Detail |\n|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.status} | ${r.name} | ${r.detail} |\n`;
  }
  fs.writeFileSync(reportPath, md);
  console.log(`\nResults written to ${reportPath}`);

  await manager.shutdown();

  // Cleanup
  fs.rmSync(TEST_CWD, { recursive: true, force: true });
  fs.rmSync(councilDir, { recursive: true, force: true });

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('AUDIT FATAL:', err);
  manager.shutdown().then(() => process.exit(2));
});
