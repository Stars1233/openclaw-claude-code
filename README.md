<p align="center">
  <img src="./assets/banner.jpg" alt="Claw Orchestrator" width="100%">
</p>

# Claw Orchestrator

> Run Claude Code, Codex, Gemini, Cursor Agent, OpenCode, and custom coding CLIs as one unified, programmable runtime.

[![npm version](https://img.shields.io/npm/v/@enderfga/claw-orchestrator.svg)](https://www.npmjs.com/package/@enderfga/claw-orchestrator)
[![CI](https://github.com/Enderfga/claw-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/Enderfga/claw-orchestrator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Coding agents are designed as interactive CLIs. Claw Orchestrator turns them into headless, programmable engines: persistent sessions, multi-engine routing, multi-agent councils, autoloop iteration, and one-click web app generation — all exposed as a 55-tool API surface usable from OpenClaw, the Model Context Protocol, the embedded HTTP server, or directly from TypeScript.

---

## Quick Start

```bash
npm install -g @enderfga/claw-orchestrator
clawo serve   # dashboard at http://127.0.0.1:18796/dash
```

```ts
import { SessionManager } from "@enderfga/claw-orchestrator";

const manager = new SessionManager();
await manager.startSession({ name: "fix-tests", engine: "claude", cwd: "/project" });
const result = await manager.sendMessage("fix-tests", "Fix the failing tests");
```

---

## Features

| Feature | What it does | Reference |
|---|---|---|
| **Persistent Sessions** | Long-lived coding agents kept alive across requests, with full context, tool, model, and worktree control. | [`sessions.md`](./skills/references/sessions.md) |
| **Multi-Engine Runtime** | One interface over Claude Code, Codex, Gemini, Cursor Agent, OpenCode, and arbitrary custom CLIs. | [`multi-engine.md`](./skills/references/multi-engine.md) |
| **Multi-Agent Council** | Parallel agents in isolated git worktrees, voting on consensus until they agree. | [`council.md`](./skills/references/council.md) |
| **Autoloop** | Three-agent autonomous workspace iteration. Chat with the Planner, it spawns Coder + Reviewer into a self-iterating subloop and pushes you on regression, target-hit, or decision points. | [`autoloop.md`](./skills/references/autoloop.md) |
| **Ultraapp** | A three-agent Opus council turns a five-question interview into a deployed web app — Tailwind UI, BYOK, file-queue runtime, smoke test, all live at `localhost:19000/forge/<slug>/`. | [`ultraapp.md`](./skills/references/ultraapp.md) |
| **Tool API** | A 55-tool surface — sessions, council, ultraplan, ultrareview, autoloop, ultraapp, codex, inbox — identical across every integration. | [`tools.md`](./skills/references/tools.md) |
| **Embedded Dashboard** | Three-tab UI for Autoloop, Council, and Forge with sidebar lifecycle controls, per-run live event streaming, and cookie-based auth via a `/login` redirect. | [`dashboard.md`](./skills/references/dashboard.md) |

---

## Integrations

### Standalone CLI

```bash
clawo serve                                            # dashboard + HTTP server on :18796
clawo session-start fix-tests --engine claude --cwd .  # start a session
clawo session-send fix-tests "Fix the failing tests"   # send into it
```

Every command is documented in [`cli.md`](./skills/references/cli.md).

### OpenClaw Plugin

```bash
curl -fsSL https://raw.githubusercontent.com/Enderfga/claw-orchestrator/main/install.sh | bash
```

Installs via npm, registers the plugin in `~/.openclaw/openclaw.json`, restarts the gateway. All 55 tools become available to every OpenClaw agent.

### Model Context Protocol Server

```bash
npm install -g @enderfga/claw-orchestrator   # clawo-mcp is now on PATH
```

Register `clawo-mcp` with any MCP-compatible host: Hermes Agent, Claude Desktop, Cursor, Cline, Continue, Zed, Windsurf, Goose, and others. Per-host stdio-config snippets and the `CLAWO_MCP_TOOLS` allowlist for tight tool budgets are in [`mcp.md`](./skills/references/mcp.md).

### TypeScript Library

```ts
import { SessionManager } from "@enderfga/claw-orchestrator";
```

Full API in [`sessions.md`](./skills/references/sessions.md). Source is under [`src/`](./src).

### OpenAI-Compatible Proxy

`clawo serve` exposes `POST /v1/chat/completions`, translating OpenAI requests into native Anthropic, OpenAI, and Google calls and streaming responses back in OpenAI shape. Point any OpenAI-SDK client at the orchestrator without changing call sites. See [`openai-compat.md`](./skills/references/openai-compat.md).

---

## Engine Compatibility

| Engine | CLI | Tested Version |
|---|---|---|
| Claude Code | `claude` | 2.1.126 |
| Codex | `codex` | 0.128.0 |
| Gemini | `gemini` | 0.36.0 |
| Cursor Agent | `agent` | 2026.03.30 |
| OpenCode | `opencode` | 1.1.40 |
| Custom CLI | any | — |

Any coding CLI that runs as a subprocess can be wired up as a custom engine — see [`multi-engine.md`](./skills/references/multi-engine.md#custom-engine-enginecustom).

---

## Documentation

All operator docs live in [`skills/references/`](./skills/references/). Source-level architecture notes are in [`CLAUDE.md`](./CLAUDE.md).

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Run `npm run build && npm run lint && npm run format:check && npm run test` before submitting.

## License

MIT — see [`LICENSE`](./LICENSE).
