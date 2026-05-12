# Reference trace format

Each `.jsonl` file contains a sequence of trace entries. The replayer
(`src/__tests__/ultraapp/trace-replayer.ts`) walks them in order: pre-loads
the canned Claude replies into a stubbed `SessionManager`, then drives user
actions (answers / file ingestion) into the real `UltraappManager`. The
resulting on-disk `spec.json` is compared against the matching
`expected/<name>.appspec.json` snapshot.

## Entry shapes

```jsonc
// Simulates Claude's reply for the next interview turn (pre-loaded into
// the stubbed sendMessage queue).
{ "kind": "claude-question", "envelope": <QuestionEnvelope> }

// Simulates Claude calling a runtime tool. The replayer pre-loads the
// reply containing the <tool> XML; the real tool runner executes against
// the test store. For tools that need a stubbed result (extract_metadata),
// embed `result` and the runner mock returns that value.
{ "kind": "claude-tool", "tool": "update_spec", "args": [...] }
{ "kind": "claude-tool", "tool": "extract_metadata", "args": {...}, "result": {...} }
{ "kind": "claude-tool", "tool": "check_completeness", "result": {"ok": true, "missing": []} }

// Simulates Claude emitting [INTERVIEW: COMPLETE].
{ "kind": "claude-complete", "summary": "..." }

// Simulates a user submitting an answer to the previous question.
{ "kind": "user-answer", "value": "<chosen option value>", "freeform": "<text>"? }

// Simulates a user uploading or referencing a file.
{ "kind": "user-file", "filename": "<name>", "contents-b64": "<...>" }
{ "kind": "user-path", "absolutePath": "<path>" }
```

## Authoring a new trace

1. Run a real interview through the dashboard (Forge tab → + New).
2. Copy each Claude reply (the question envelope) and each user action into
   the JSONL file in order. For `update_spec` tool calls, copy the JSON
   patch operations into `args`.
3. After the interview ends, copy the final `~/.claw-orchestrator/ultraapps/<runId>/spec.json`
   into `expected/<trace-name>.appspec.json`.
4. Add the trace name to the `TRACES` array in
   `src/__tests__/ultraapp/spec-extraction-quality.test.ts`.

## Status of bundled traces

- **text-summariser** — synthetic hand-crafted reference; demonstrates the
  format. Real-API-captured replacements should land as user follow-up.
- **image-batch-resize**, **vlog-cut**, **llm-agent-pipeline**,
  **branching-dag** — planned in v1.0; deferred (require live LLM
  authoring). When each lands, drop the `.jsonl` + `expected/*.appspec.json`
  here and append to `TRACES`.
