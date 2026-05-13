# Dashboard

The dashboard is a single-page HTML app served by the orchestrator's embedded
HTTP server. It lets you **launch and observe** Council sessions, Autoloop
runs, and Forge (Ultraapp) builds from a browser — no CLI, no webchat, no
plugin tool calls needed.

URL: `http://127.0.0.1:18796/dash` (local) or whatever public hostname you
front the embedded server with (the recommended setup uses a path-based
reverse proxy, e.g. `https://<your-host>/dash`).

## Tabs

| Tab | Backed by | Launch endpoint |
|---|---|---|
| Autoloop | `SessionManager.autoloopStart()` | `POST /autoloop/new` |
| Council | `SessionManager.councilStart()` | `POST /council/new` |
| Forge | `UltraappManager.createRun()` | `POST /ultraapp/new` |

Each tab has a `+ New` button in the sidebar. Council and Autoloop open a
modal form (because they need workspace/task input); Forge POSTs an empty
body and drops you into an interview (the spec is built conversationally).

## Standalone deployment

The recommended way to run the dashboard 24/7 is a separate `clawo serve`
process under launchd — completely decoupled from the OpenClaw gateway. The
gateway's plugin-side embedded server still works (lazy init on first tool
call); when both processes try to bind the default port, the loser gracefully
skips, so the two coexist without conflict.

Example `~/Library/LaunchAgents/com.clawo.serve.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.clawo.serve</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>5</integer>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/node</string>
      <string>/opt/homebrew/bin/clawo</string>
      <string>serve</string>
      <string>--port</string><string>18796</string>
      <string>--host</string><string>127.0.0.1</string>
    </array>
    <key>StandardOutPath</key>
    <string>/Users/USER/.openclaw/logs/clawo-serve.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/USER/.openclaw/logs/clawo-serve.log</string>
  </dict>
</plist>
```

Bootstrap:

```sh
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.clawo.serve.plist
launchctl print "gui/$(id -u)/com.clawo.serve" | grep state
```

## Auth

The embedded server self-generates a 32-byte token at startup and writes it
to `~/.openclaw/server-token` (mode 0600). For browser access the standard
pattern is a one-time `/login` redirect:

```
https://<your-host>/login?token=<token-value>&redirect=/dash
```

The server validates the token, sets an `HttpOnly clawo_auth` cookie, and
302s to `/dash`. Subsequent visits authenticate by cookie — bookmark
`/dash` directly. The token never appears in the bookmark URL or referrer
headers.

Token-file write is deferred to the `listen()`-success callback so a second
process that loses the EADDRINUSE race does NOT clobber the winner's token.

## Cross-process visibility

When the dashboard runs in a different process from where you spawn runs
(e.g. you started a council via the OpenClaw plugin tool from webchat, but
the dashboard is in `clawo serve`), the run state is invisible across
in-memory boundaries. The dashboard fixes this by unioning in-memory state
with on-disk records on every list call:

- **Councils**: `~/.openclaw/council-logs/council-*.md` — parsed for
  `- **ID**:`, `- **Time**:`, `- **Task**:`, `- **Status**:` headers.
  Legacy transcripts (pre-v4.0) fall back to a filename-derived id.
- **Autoloops**: `~/.claw-orchestrator/autoloop-registry.jsonl` — an
  append-only JSONL index written by `autoloopStart()`. Stale entries
  whose ledger directory no longer exists are filtered out at read time.
- **Forge**: `UltraappStore.listRuns()` already reads from disk
  (`~/.claw-orchestrator/ultraapps/`).

Result: any run you've ever started — from any process — shows up in the
sidebar, sorted newest-first, until the underlying files are deleted.

## Reverse-proxy integration

If you front the embedded server with sasha-doctor (or another reverse
proxy), route these paths to `127.0.0.1:18796`:

- `/dashboard`, `/dash`, `/login`
- `/autoloop/*`, `/council/*`, `/ultraapp/*`

The dashboard's relative `fetch()` calls expect the proxy to preserve the
path verbatim — no prefix stripping. `/v1/openclaw/*` should keep routing
to the OpenClaw gateway, not the embedded server.

## Reset

To wipe dashboard state without touching real run data:

```sh
# Forget all known autoloops (council/forge unchanged).
rm ~/.claw-orchestrator/autoloop-registry.jsonl

# Force the standalone server to mint a fresh auth token.
launchctl kickstart -k "gui/$(id -u)/com.clawo.serve"
# Then visit /login?token=$(cat ~/.openclaw/server-token)&redirect=/dash once
# to refresh the cookie.
```
