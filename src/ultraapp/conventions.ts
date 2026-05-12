/**
 * The architectural conventions every council-generated codebase must satisfy.
 * Embedded in the council super-task prompt by council-adapter.ts.
 *
 * Single source of truth: any change here flows to all builds, including
 * v0.5 spec-delta reruns and v1.0 reference-trace assertions.
 */

export const ARCHITECTURAL_CONVENTIONS = `
You are building a deployable web app. Your codebase MUST satisfy the following
architectural conventions. They are non-negotiable; non-compliant codebases
will be rejected at fix-on-failure or deploy time.

## 1. Path-based deploy

The app will be served behind a reverse proxy at /forge/<slug>/ on port 19000.
The slug equals AppSpec.meta.name and is provided to your container as the
BASE_PATH environment variable at "docker run" time.

You MUST configure your framework's base path setting from BASE_PATH:
- Next.js:    next.config.js → basePath: process.env.BASE_PATH ?? ''
- Vite:       vite.config.ts → base: process.env.BASE_PATH ?? '/'
- SvelteKit:  paths.base via $env/dynamic/private
- Hono/express: prefix routes with process.env.BASE_PATH

All in-app links and fetches MUST be relative to base; no hardcoded absolute
paths. <base href> tag in HTML must be set from BASE_PATH.

## 2. Async file-queue runtime

The app MUST expose exactly these HTTP endpoints. No more, no fewer (apart from
framework-required static asset routes):

  GET /                     — render the input form derived from AppSpec.inputs
  POST /run                 — multipart upload of inputs. Returns
                              { jobId, statusUrl, resultUrl }. Synchronously
                              writes inputs to /data/jobs/<jobId>/inputs/ and
                              returns immediately; pipeline runs in a background
                              worker.
  GET /status/:jobId        — { progress: 0..1, currentStep: string,
                                state: 'queued'|'running'|'done'|'failed',
                                error?: string }
  GET /result/:jobId        — returns output file(s) per AppSpec.outputs.
                              Returns 404 until state === 'done'.
  GET /health               — plain "200 OK" for the deploy health check.

Persistence layout under the container's /data volume:

  /data/
    jobs/
      <jobId>/
        inputs/<name>     — uploaded files
        outputs/<name>    — pipeline outputs
        state.json        — { progress, currentStep, state, error }
        log.txt           — step-by-step log

NO database. NO SQLite. File-based queue only. Job retention: 7 days, then
GC by a background sweeper that runs once per hour inside the container.

## 3. BYOK (only if AppSpec.runtime.needsLLM is true)

If pipelines call an LLM provider, the API key MUST come from the user's
browser localStorage and be passed in fetch requests directly from browser to
provider. The server MUST NEVER receive the key.

Frontend:
- On first load, read localStorage for byok.<provider> keys.
- If missing, show a modal: "This app uses <Provider>. Enter your API key.
  Stored in your browser only."
- Store via localStorage.setItem('byok.<provider>', key).

Server:
- MUST NOT read process.env.<*>_API_KEY in any non-test file.
- MUST NOT accept an "Authorization" or "x-api-key" header on /run.
- A custom ESLint rule (ship as eslint-plugin-no-server-keys with the
  skeleton) enforces this. Smoke test asserts /run rejects requests carrying
  any auth headers. The server must never receive the key.

If AppSpec.runtime.needsLLM is false, omit the BYOK panel entirely.

## 4. Dockerfile + smoke test

Single Dockerfile at the repo root. Multi-stage. Final stage exposes port 3000
internally. ENTRYPOINT runs the production server. Build args:
  - BASE_PATH (passed by deployer at run time, defaulted at build time to '')

Smoke test: package.json must expose "scripts.smoke" that drives ONE complete
job using AppSpec.inputs[].examples[0].ref files copied into the image at
build time under /data/_smoke/. The smoke test asserts pipeline completes and
output matches AppSpec.outputs[].type. fix-on-failure runs "npm run smoke" and
gates build-success on its passing.

Smoke test must complete in < 90 seconds for the reference-trace inputs
provided. If your pipeline genuinely takes longer, design the smoke test to
use a degenerate-small input (e.g., 5-second clip vs 5-minute) but still
exercise every step of the DAG.

## 5. Council voting protocol

This is a 3-agent council collaborating in separate git worktrees. Each round:
- Read the spec + the architectural conventions above + the current codebase
  state on the shared 'main' branch (other agents' work).
- Make changes in your worktree, commit, merge to main with a clear commit
  message.
- At the end of your turn, vote with the literal marker:
  [CONSENSUS: YES]   — if codebase fully implements spec + all conventions met
  [CONSENSUS: NO]    — otherwise; explain what's still wrong/missing

Collaboration ends only when ALL 3 agents vote YES, or after maxRounds=8.

## 6. Tech stack

You may pick any modern TypeScript or JavaScript framework that satisfies the
above. Recommended choices: Next.js 15+, Vite + Hono, SvelteKit. AVOID:
Python (this is a Node ecosystem app), pure static-site generators (need
server endpoints).
`.trim();
