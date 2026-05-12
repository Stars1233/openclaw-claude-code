/**
 * Embedded HTTP Server — auto-starts with plugin, serves CLI commands
 *
 * This is NOT a separate process. It runs inside the plugin (or standalone)
 * and provides HTTP endpoints for the CLI to connect to.
 *
 * Users never need to configure or manage this — it just works.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { SessionManager } from './session-manager.js';
import { sanitizeCwd, validateRegex } from './validation.js';
import type { EffortLevel } from './types.js';
import { handleChatCompletion } from './openai-compat.js';
import { getModelList } from './models.js';

import {
  DEFAULT_SERVER_PORT,
  MAX_BODY_SIZE,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  OPENAI_COMPAT_SESSION_PREFIX,
} from './constants.js';

export class EmbeddedServer {
  private server: http.Server | null = null;
  private manager: SessionManager;
  private port: number;
  private authToken: string | null = null;
  private _rateWindows = new Map<string, number[]>();
  private _rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private _rateLimit: number;
  private host: string;

  constructor(manager: SessionManager, port?: number, host?: string) {
    this.manager = manager;
    this.port = port || DEFAULT_SERVER_PORT;
    this.host = host || process.env.OPENCLAW_SERVER_HOST || '127.0.0.1';
    this._rateLimit = parseInt(process.env.OPENCLAW_RATE_LIMIT || '', 10) || RATE_LIMIT_MAX_REQUESTS;
  }

  private _checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const window = this._rateWindows.get(ip) || [];
    const recent = window.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    recent.push(now);
    this._rateWindows.set(ip, recent);
    return recent.length <= this._rateLimit;
  }

  private _writeTokenFile(token: string): void {
    const tokenDir = path.join(os.homedir(), '.openclaw');
    try {
      if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir, { recursive: true });
      fs.writeFileSync(path.join(tokenDir, 'server-token'), token, { mode: 0o600 });
    } catch (err) {
      console.warn(`[embedded-server] failed to write server-token file: ${(err as Error).message}`);
    }
  }

  async start(): Promise<number> {
    // Auth token policy (changed in 3.5.6 — closes CWE-306 from issue #61):
    //
    //   default                    → auto-generate 32-byte random token,
    //                                  write to ~/.openclaw/server-token mode 0600.
    //                                  Required on every non-/health request via
    //                                  Bearer header OR `clawo_auth` cookie OR
    //                                  ?token=<v> query.
    //   OPENCLAW_SERVER_TOKEN=<v>  → use the explicit token (legacy behaviour).
    //   OPENCLAW_SERVER_TOKEN=disabled → opt out of auth entirely. Only safe on
    //                                  a single-user host; loud warning at start.
    //
    // The file is mode 0600 (owner-read-only). Same-user CLI + dashboard read it;
    // other users on the same box cannot. Browsers reach /dashboard via the
    // `?token=<v>` query once; the server replies with a Set-Cookie so subsequent
    // requests authenticate via the cookie.
    const envToken = process.env.OPENCLAW_SERVER_TOKEN;
    if (envToken === 'disabled') {
      this.authToken = null;
      console.warn(
        '[embedded-server] OPENCLAW_SERVER_TOKEN=disabled — authentication is OFF. ' +
          'All endpoints are reachable to any process that can connect. Only safe on a trusted single-user host.',
      );
    } else if (envToken) {
      this.authToken = envToken;
      this._writeTokenFile(this.authToken);
    } else {
      this.authToken = crypto.randomBytes(32).toString('hex');
      this._writeTokenFile(this.authToken);
    }

    this._rateLimitCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [ip, timestamps] of this._rateWindows) {
        const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
        if (recent.length === 0) this._rateWindows.delete(ip);
        else this._rateWindows.set(ip, recent);
      }
    }, RATE_LIMIT_WINDOW_MS);
    this._rateLimitCleanupTimer.unref();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Port already in use — another instance running, skip
          console.log(`[embedded-server] Port ${this.port} in use, skipping (another instance running)`);
          this.server = null;
          resolve(0);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, this.host, () => {
        if (this.authToken) {
          console.log(`[embedded-server] Listening on http://${this.host}:${this.port} (auth enabled)`);
          console.log(`[embedded-server] Token file: ${path.join(os.homedir(), '.openclaw', 'server-token')}`);
          console.log(
            `[embedded-server] Dashboard:  http://${this.host}:${this.port}/dashboard?token=${this.authToken}`,
          );
        } else {
          console.log(`[embedded-server] Listening on http://${this.host}:${this.port} (AUTH DISABLED)`);
        }
        resolve(this.port);
      });
    });
  }

  async stop(): Promise<void> {
    if (this._rateLimitCleanupTimer) {
      clearInterval(this._rateLimitCleanupTimer);
      this._rateLimitCleanupTimer = null;
    }
    // Only delete token file if it matches our token
    try {
      const tokenPath = path.join(os.homedir(), '.openclaw', 'server-token');
      const stored = fs.readFileSync(tokenPath, 'utf8');
      if (stored === this.authToken) fs.unlinkSync(tokenPath);
    } catch {
      /* ignore */
    }
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => resolve());
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS — localhost by default; /v1/ paths allow all origins (for webchat frontends)
    const origin = req.headers.origin || '';
    const urlPath = new URL(req.url || '/', `http://localhost:${this.port}`).pathname;
    const corsAllowAll = process.env.OPENCLAW_CORS_ORIGINS === '*';
    const isV1Path = urlPath.startsWith('/v1/');
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(origin);
    if (isLocalhost || isV1Path || corsAllowAll) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${this.port}`);
    const path = url.pathname;

    // Auth: accept Bearer header, `clawo_auth` cookie, or `?token=` query
    // (auth-skip allow-list: /health for monitoring).
    if (this.authToken && path !== '/health') {
      const authHeader = req.headers.authorization || '';
      const queryToken = url.searchParams.get('token');
      const cookieHeader = req.headers.cookie || '';
      const cookieToken = /(?:^|;\s*)clawo_auth=([^;]+)/.exec(cookieHeader)?.[1];

      const bearerOk = authHeader === `Bearer ${this.authToken}`;
      const queryOk = queryToken === this.authToken;
      const cookieOk = cookieToken === this.authToken;

      if (!bearerOk && !queryOk && !cookieOk) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            error: 'Unauthorized',
            hint: 'Send Authorization: Bearer <token> (token at ~/.openclaw/server-token), or visit /dashboard?token=<token> in a browser to set the cookie.',
          }),
        );
        return;
      }

      // First-touch via query token → persist as cookie so subsequent same-origin
      // requests (including EventSource) authenticate without exposing the token
      // in URLs / referrers / access logs.
      if (queryOk && !cookieOk) {
        res.setHeader('Set-Cookie', `clawo_auth=${this.authToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
      }
    }

    // Rate limiting
    const clientIp = req.socket.remoteAddress || 'unknown';
    if (!this._checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Rate limit exceeded' }));
      return;
    }

    // Read body for POST — require JSON content type (CSRF mitigation)
    if (req.method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('application/json')) {
        res.writeHead(415, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Content-Type must be application/json' }));
        return;
      }
      let body = '';
      let aborted = false;
      req.on('data', (chunk) => {
        if (aborted) return;
        body += chunk;
        if (body.length > MAX_BODY_SIZE) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
          req.destroy();
        }
      });
      req.on('end', () => {
        if (aborted) return;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
          return;
        }
        this.route(path, parsed, url.searchParams, res, req.headers);
      });
    } else {
      this.route(path, {}, url.searchParams, res, req.headers);
    }
  }

  private async route(
    path: string,
    body: Record<string, unknown>,
    query: URLSearchParams,
    res: http.ServerResponse,
    headers: http.IncomingHttpHeaders = {},
  ): Promise<void> {
    try {
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      // ─── Session Routes ──────────────────────────────────────────

      if (path === '/session/start') {
        if (body.cwd) body.cwd = sanitizeCwd(body.cwd as string);
        const info = await this.manager.startSession(body as Parameters<SessionManager['startSession']>[0]);
        json(200, { ok: true, ...info });
        return;
      }

      if (path === '/session/send') {
        const result = await this.manager.sendMessage(body.name as string, body.message as string, {
          effort: body.effort as EffortLevel | undefined,
          plan: body.plan as boolean | undefined,
          timeout: body.timeout as number | undefined,
        });
        json(200, { ok: true, ...result });
        return;
      }

      if (path === '/session/stop') {
        await this.manager.stopSession(body.name as string);
        json(200, { ok: true });
        return;
      }

      if (path === '/session/list') {
        json(200, { ok: true, sessions: this.manager.listSessions() });
        return;
      }

      if (path === '/session/status') {
        const status = this.manager.getStatus(body.name as string);
        json(200, { ok: true, ...status });
        return;
      }

      if (path === '/session/grep') {
        validateRegex(body.pattern as string);
        const matches = await this.manager.grepSession(
          body.name as string,
          body.pattern as string,
          body.limit as number | undefined,
        );
        json(200, { ok: true, count: matches.length, matches });
        return;
      }

      if (path === '/session/compact') {
        await this.manager.compactSession(body.name as string, body.summary as string | undefined);
        json(200, { ok: true });
        return;
      }

      if (path === '/session/cost') {
        const cost = this.manager.getCost(body.name as string);
        json(200, { ok: true, ...cost });
        return;
      }

      if (path === '/session/model') {
        this.manager.setModel(body.name as string, body.model as string);
        json(200, { ok: true });
        return;
      }

      if (path === '/session/effort') {
        this.manager.setEffort(body.name as string, body.level as EffortLevel);
        json(200, { ok: true });
        return;
      }

      // ─── Agent Teams ─────────────────────────────────────────────

      if (path === '/session/team-list') {
        const response = await this.manager.teamList(body.name as string);
        json(200, { ok: true, response });
        return;
      }

      if (path === '/session/team-send') {
        const result = await this.manager.teamSend(
          body.name as string,
          body.teammate as string,
          body.message as string,
        );
        json(200, { ok: true, ...result });
        return;
      }

      // ─── File Management ─────────────────────────────────────────

      if (path === '/agents') {
        const cwd = query.get('cwd') || undefined;
        json(200, { ok: true, agents: this.manager.listAgents(cwd) });
        return;
      }

      if (path === '/agents/create') {
        const p = this.manager.createAgent(
          body.name as string,
          body.cwd as string | undefined,
          body.description as string | undefined,
          body.prompt as string | undefined,
        );
        json(200, { ok: true, path: p });
        return;
      }

      if (path === '/skills') {
        const cwd = query.get('cwd') || undefined;
        json(200, { ok: true, skills: this.manager.listSkills(cwd) });
        return;
      }

      if (path === '/skills/create') {
        const p = this.manager.createSkill(
          body.name as string,
          body.cwd as string | undefined,
          body as Record<string, string>,
        );
        json(200, { ok: true, path: p });
        return;
      }

      if (path === '/rules') {
        const cwd = query.get('cwd') || undefined;
        json(200, { ok: true, rules: this.manager.listRules(cwd) });
        return;
      }

      if (path === '/rules/create') {
        const p = this.manager.createRule(
          body.name as string,
          body.cwd as string | undefined,
          body as Record<string, string>,
        );
        json(200, { ok: true, path: p });
        return;
      }

      // ─── Health ──────────────────────────────────────────────────

      if (path === '/health') {
        json(200, { ok: true, version: this.manager.getVersion(), sessions: this.manager.listSessions().length });
        return;
      }

      // ─── OpenAI-Compatible Routes ─────────────────────────────

      if (path === '/v1/chat/completions') {
        await handleChatCompletion(this.manager, body, headers, res);
        return;
      }

      if (path === '/v1/models') {
        json(200, getModelList());
        return;
      }

      if (path === '/v1/sessions') {
        // Inspection endpoint for openai-compat sessions only — not interactive
        // CLI sessions. Production observability: lets ops verify the persistent
        // CLI is being reused (cached_tokens grows turn-over-turn) instead of
        // killed every request. Bearer-token gated like the rest of /v1/*.
        const rows = this.manager
          .listSessions()
          .filter((s) => s.name.startsWith(OPENAI_COMPAT_SESSION_PREFIX))
          .map((s) => {
            let stats: ReturnType<SessionManager['getStatus']>['stats'] | null = null;
            try {
              stats = this.manager.getStatus(s.name).stats;
            } catch {
              /* session may have just been reaped */
            }
            return {
              key: s.name.slice(OPENAI_COMPAT_SESSION_PREFIX.length),
              session_name: s.name,
              model: s.model,
              cwd: s.cwd,
              created: s.created,
              turns: stats?.turns,
              tokens_in: stats?.tokensIn,
              tokens_out: stats?.tokensOut,
              cached_tokens: stats?.cachedTokens,
              context_percent: stats?.contextPercent,
              cost_usd: stats?.costUsd,
            };
          });
        json(200, { object: 'list', data: rows });
        return;
      }

      // ─── Dashboard (single static HTML) ─────────────────────────
      //
      // Serves src/dashboard/index.html (or dist/src/dashboard/index.html in
      // a built install). Walks up like resolveConfigPath does so it works
      // both during dev (tsx) and from the published package.

      if (path === '/dashboard' || path === '/dashboard/' || path === '/dashboard/index.html') {
        const fsMod = await import('node:fs');
        const pathMod = await import('node:path');
        const urlMod = await import('node:url');
        const here = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
        let dir = here;
        let file = null;
        for (let i = 0; i < 8; i++) {
          const candidate = pathMod.join(dir, 'src', 'dashboard', 'index.html');
          if (fsMod.existsSync(candidate)) {
            file = candidate;
            break;
          }
          const parent = pathMod.dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
        if (!file) {
          json(404, { ok: false, error: 'dashboard asset not found' });
          return;
        }
        const html = fsMod.readFileSync(file, 'utf-8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(html);
        return;
      }

      // ─── Council — list / state / events ────────────────────────
      //
      // Mirrors the autoloop endpoints below. The dashboard page consumes
      // these to render the council tab.

      if (path === '/council/list') {
        json(200, { ok: true, councils: this.manager.councilList() });
        return;
      }

      const councilStateMatch = path.match(/^\/council\/([^/]+)\/state$/);
      if (councilStateMatch) {
        const session = this.manager.councilStatus(councilStateMatch[1]);
        if (!session) {
          json(404, { ok: false, error: 'council not found' });
        } else {
          json(200, { ok: true, session });
        }
        return;
      }

      const councilEventsMatch = path.match(/^\/council\/([^/]+)\/events$/);
      if (councilEventsMatch) {
        const id = councilEventsMatch[1];
        const council = this.manager.getCouncil(id);
        if (!council) {
          json(404, { ok: false, error: 'council not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const send = (event: string, data: unknown): void => {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        // Replay current session so the dashboard renders immediately.
        const snap = council.getSession();
        if (snap) send('snapshot', snap);

        const onEvent = (e: unknown): void => send('council-event', e);
        const cleanup = (): void => {
          council.off('council-event', onEvent);
          try {
            res.end();
          } catch {
            /* ignore */
          }
        };
        council.on('council-event', onEvent);
        res.on('close', cleanup);
        return;
      }

      // ─── Autoloop — list / state / push log / SSE events ─────
      //
      // Front-end contract (per tasks/autoloop.md §9). Webchat opens these
      // when rendering a 3-pane Orchestrator view.

      if (path === '/autoloop/list') {
        json(200, { ok: true, runs: this.manager.autoloopList() });
        return;
      }

      const v2StateMatch = path.match(/^\/autoloop\/([^/]+)\/state$/);
      if (v2StateMatch) {
        const state = this.manager.autoloopStatus(v2StateMatch[1]);
        if (!state) {
          json(404, { ok: false, error: 'run not found' });
        } else {
          json(200, { ok: true, state });
        }
        return;
      }

      const v2PushLogMatch = path.match(/^\/autoloop\/([^/]+)\/push_log$/);
      if (v2PushLogMatch) {
        const id = v2PushLogMatch[1];
        const ctx = this.manager.getAutoloop(id);
        if (!ctx) {
          json(404, { ok: false, error: 'run not found' });
          return;
        }
        // push_log lives at <ledger>/push_log.jsonl — the dispatcher knows
        // the ledger dir. We re-derive it here to avoid leaking dispatcher
        // internals through the manager.
        const fsMod = await import('node:fs');
        const pathMod = await import('node:path');
        const ledgerDir = pathMod.join(ctx.dispatcher.config.workspace, 'tasks', id);
        const file = pathMod.join(ledgerDir, 'push_log.jsonl');
        const lines: unknown[] = [];
        if (fsMod.existsSync(file)) {
          for (const line of fsMod.readFileSync(file, 'utf-8').split('\n')) {
            if (!line.trim()) continue;
            try {
              lines.push(JSON.parse(line));
            } catch {
              /* skip malformed line */
            }
          }
        }
        json(200, { ok: true, entries: lines });
        return;
      }

      const v2EventsMatch = path.match(/^\/autoloop\/([^/]+)\/events$/);
      if (v2EventsMatch) {
        const id = v2EventsMatch[1];
        const ctx = this.manager.getAutoloop(id);
        if (!ctx) {
          json(404, { ok: false, error: 'run not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const send = (event: string, data: unknown): void => {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        send('snapshot', { state: ctx.runner.state });

        const onMessage = (env: unknown): void => send('message', env);
        const onState = (s: unknown): void => send('state', s);
        const onPush = (e: unknown): void => send('push', e);
        const onIterDone = (e: unknown): void => send('iter_done', e);
        const onTerm = (r: unknown): void => {
          send('terminated', { reason: r });
          cleanup();
        };
        const onPlannerReply = (text: unknown): void => send('planner_reply', { text });
        const onCoderReply = (text: unknown): void => send('coder_reply', { text });
        const onReviewerReply = (text: unknown): void => send('reviewer_reply', { text });
        const onCompact = (e: unknown): void => send('compact', e);
        const cleanup = (): void => {
          ctx.runner.off('message', onMessage);
          ctx.runner.off('state', onState);
          ctx.runner.off('push', onPush);
          ctx.runner.off('iter_done', onIterDone);
          ctx.runner.off('terminated', onTerm);
          ctx.dispatcher.off('planner_reply', onPlannerReply);
          ctx.dispatcher.off('coder_reply', onCoderReply);
          ctx.dispatcher.off('reviewer_reply', onReviewerReply);
          ctx.dispatcher.off('compact', onCompact);
          try {
            res.end();
          } catch {
            /* ignore */
          }
        };
        ctx.runner.on('message', onMessage);
        ctx.runner.on('state', onState);
        ctx.runner.on('push', onPush);
        ctx.runner.on('iter_done', onIterDone);
        ctx.runner.on('terminated', onTerm);
        ctx.dispatcher.on('planner_reply', onPlannerReply);
        ctx.dispatcher.on('coder_reply', onCoderReply);
        ctx.dispatcher.on('reviewer_reply', onReviewerReply);
        ctx.dispatcher.on('compact', onCompact);
        res.on('close', cleanup);
        return;
      }

      // ─── ultraapp ─────────────────────────────────────────────
      // Forge-tab routes. The events endpoint is SSE; the rest return JSON.

      const uaSseMatch = path.match(/^\/ultraapp\/([^/]+)\/events$/);
      if (uaSseMatch) {
        const runId = uaSseMatch[1];
        const ua = this.manager.getUltraappManager?.();
        if (!ua) {
          json(404, { ok: false, error: 'ultraapp manager unavailable' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        let unsub: (() => void) | null = null;
        try {
          unsub = ua.subscribe(runId, (ev: unknown) => {
            res.write(`event: ultraapp\n`);
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          });
        } catch (e) {
          res.write(`event: error\n`);
          res.write(`data: ${JSON.stringify({ message: (e as Error).message })}\n\n`);
          res.end();
          return;
        }
        res.on('close', () => unsub?.());
        return;
      }

      const uaMatch = path.match(/^\/ultraapp(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/);
      if (uaMatch) {
        const ua = this.manager.getUltraappManager?.();
        if (!ua) {
          json(404, { ok: false, error: 'ultraapp manager unavailable' });
          return;
        }
        const seg1 = uaMatch[1];
        const seg2 = uaMatch[2];
        const seg3 = uaMatch[3];

        if (seg1 === 'list' && !seg2) {
          const runs = await ua.store.listRuns();
          json(200, { ok: true, runs });
          return;
        }
        if (seg1 === 'new' && !seg2) {
          const runId = await ua.createRun();
          json(200, { ok: true, runId });
          return;
        }
        if (seg1 && !seg2) {
          try {
            const [spec, chat, state] = await Promise.all([
              ua.store.readSpec(seg1),
              ua.store.readChat(seg1),
              ua.store.readState(seg1),
            ]);
            json(200, { ok: true, spec, chat, state });
          } catch (e) {
            json(404, { ok: false, error: (e as Error).message });
          }
          return;
        }
        if (seg1 && seg2 === 'answer') {
          await ua.submitAnswer(seg1, body as { value: string; freeform?: string });
          json(200, { ok: true });
          return;
        }
        if (seg1 && seg2 === 'spec-edit') {
          await ua.applySpecEdit(seg1, (body as { patch: unknown[] }).patch as never);
          json(200, { ok: true });
          return;
        }
        if (seg1 && seg2 === 'build' && seg3 === 'cancel') {
          ua.cancelBuild(seg1);
          json(200, { ok: true });
          return;
        }
        if (seg1 && seg2 === 'build' && !seg3) {
          await ua.startBuild(seg1);
          json(200, { ok: true });
          return;
        }
        if (seg1 && seg2 === 'artifacts' && !seg3) {
          const arts = await ua.store.readArtifacts(seg1);
          json(200, { ok: true, artifacts: arts });
          return;
        }
        if (seg1 && seg2 === 'files') {
          const b = body as Record<string, unknown>;
          if (typeof b.absolutePath === 'string') {
            const r = await ua.addFile(seg1, { kind: 'path', absolutePath: b.absolutePath });
            json(200, { ok: true, ...r });
            return;
          }
          if (typeof b.filename === 'string' && typeof b.dataB64 === 'string') {
            const data = Buffer.from(b.dataB64, 'base64');
            const r = await ua.addFile(seg1, { kind: 'upload', filename: b.filename, data });
            json(200, { ok: true, ...r });
            return;
          }
          json(400, { ok: false, error: 'must provide absolutePath OR filename+dataB64' });
          return;
        }
      }

      // Use OpenAI error format for /v1/* paths
      if (path.startsWith('/v1/')) {
        json(404, { error: { message: 'Not found', type: 'invalid_request_error', code: null } });
      } else {
        json(404, { ok: false, error: 'Not found' });
      }
    } catch (err) {
      const message = (err as Error).message;
      if (path.startsWith('/v1/')) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message, type: 'server_error', code: null } }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
    }
  }
}
