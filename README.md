# CV–JD Match

Paste a job description (JD) and a CV as plain text. The app returns:

- a **match score** from 0 to 100, computed in code (not by the LLM)
- each **JD requirement**, marked *met*, *partly met* or *not met*
- for every met or partly met requirement, an **exact quote from the CV** as evidence, checked in code
- a list of **gaps**
- up to 5 **suggested CV bullet rewrites** that only reuse facts already in the CV

Users can rate each result with thumbs up or down, and the page footer shows live usage stats.

> **Privacy:** Your text is sent to an LLM to produce the result and is not stored. Only scores and feedback are saved.

The whole stack runs on free tiers with no credit card: Groq (LLM), Neon (Postgres), Netlify (hosting + functions) and GitHub (repo + Actions).

## Architecture

```mermaid
flowchart LR
    B["Browser<br/>React + TypeScript page"]
    subgraph Netlify
        M["/api/match<br/>function"]
        F["/api/feedback<br/>function"]
        S["/api/stats<br/>function"]
    end
    G["Groq API<br/>openai/gpt-oss-120b<br/>(strict JSON schema)"]
    D[("Postgres<br/>Neon in production,<br/>Docker locally")]

    B -- "POST {jd, cv}" --> M
    M -- "prompt + JSON schema" --> G
    G -- "JSON answer" --> M
    M -- "INSERT numbers only" --> D
    B -- "POST {id, helpful}" --> F
    F -- "UPDATE helpful" --> D
    B -- "GET" --> S
    S -- "SELECT aggregates" --> D
```

Inside `/api/match`:

```mermaid
flowchart TD
    A[Validate input with zod<br/>non-empty, ≤ 20,000 chars each] --> T{Estimated prompt tokens<br/>≤ 6,000?}
    T -- no --> E413[413: too long for the free tier]
    T -- yes --> L[Call Groq<br/>retry up to 2× on HTTP 429]
    L --> P{Valid JSON for<br/>the zod schema?}
    P -- no, first time --> L2[Ask once more] --> P2{Valid?}
    P2 -- no --> E502[502: invalid answer twice]
    P -- yes --> GC
    P2 -- yes --> GC[Grounding check<br/>every quote must be in the CV]
    GC --> SC[Score in code<br/>met 1, partly 0.5, not met 0]
    SC --> DB[Save one row: id, created_at, score,<br/>requirement_count, ungrounded_count, latency_ms, model]
    DB --> R[200: result JSON]
```

## Run it locally

You need Node 22 and Docker. Create a `.env` file from the template and fill in your values:

```bash
cp .env.example .env     # then edit .env: GROQ_API_KEY (and optionally LLM_MODEL)
```

Get a free Groq key at <https://console.groq.com/keys>. Never commit `.env`; it is in `.gitignore`.

### Option A: everything in Docker

```bash
docker compose up --build
```

This starts Postgres (host port 5433), applies the migration with a one-off `migrate` container, then runs the app with `netlify dev`. Open <http://localhost:8888>. Inside Docker the app always uses the local database, whatever `DATABASE_URL` says in `.env`.

### Option B: Node on your machine, Postgres in Docker

```bash
npm install
docker compose up -d db                                          # Postgres on localhost:5433
export DATABASE_URL=postgres://cvjd:cvjd_local_only@localhost:5433/cvjd
npm run migrate                                                  # creates the match_runs table
npm run dev                                                      # netlify dev -> http://localhost:8888
```

A `DATABASE_URL` set in your shell takes priority over the one in `.env`, for both `npm run migrate` and `netlify dev`.

### Checks

```bash
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # vitest (no network; the LLM is mocked)

# Also run the database integration tests against a real Postgres:
TEST_DATABASE_URL=postgres://cvjd:cvjd_local_only@localhost:5433/cvjd npm test
```

The integration tests create a throw-away schema, run the migration in it and drop it afterwards. CI starts its own Postgres service, so they always run there.

## Deploy on Netlify

1. Create a free Neon project at <https://neon.com> and copy its **pooled** connection string (it contains `-pooler` and `sslmode=require`).
2. Apply the migration to Neon once, from your machine:
   ```bash
   DATABASE_URL='<your Neon connection string>' npm run migrate
   ```
3. Push this repo to GitHub, then in Netlify choose **Add new project → Import an existing project** and pick the repo. `netlify.toml` already holds the build settings:

   | Setting | Value |
   | --- | --- |
   | Build command | `npm run build` |
   | Publish directory | `dist` |
   | Functions directory | `netlify/functions` |
   | Node version | from `.nvmrc` (22) |

4. In **Project configuration → Environment variables**, add:

   | Variable | Value | Scopes |
   | --- | --- | --- |
   | `GROQ_API_KEY` | your Groq key | Functions |
   | `LLM_MODEL` | `openai/gpt-oss-120b` (optional; this is the default) | Functions |
   | `DATABASE_URL` | your Neon pooled connection string | Functions |
   | `AWS_LAMBDA_JS_RUNTIME` | `nodejs22.x` | Functions |

   Mark `GROQ_API_KEY` and `DATABASE_URL` as secret. Netlify says `AWS_LAMBDA_JS_RUNTIME` must be set in the UI, CLI or API, not in `netlify.toml`.
5. Deploy. The per-IP rate limits in each function's `config` are applied by Netlify automatically.

## Environment variables

| Variable | Used by | Required | Meaning |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | functions, eval | yes | Groq API key |
| `LLM_MODEL` | functions, eval | no | Groq model id. Default `openai/gpt-oss-120b`. It must support strict JSON-schema output. |
| `DATABASE_URL` | functions, `npm run migrate` | yes | Postgres connection string |
| `TEST_DATABASE_URL` | tests | no | Enables the database integration tests |
| `EVAL_DELAY_MS` | eval | no | Pause between eval cases, default `20000` |
| `EVAL_ONLY` | eval | no | Comma-separated case ids to run a subset |
| `EVAL_OUT_DIR` | eval | no | Where to write results, default `eval/` |
| `POSTGRES_PORT` | docker compose | no | Host port for local Postgres, default `5433` |
| `AWS_LAMBDA_JS_RUNTIME` | Netlify UI only | recommended | `nodejs22.x` |

`.env.example` lists the names only.

## Why `openai/gpt-oss-120b`

I checked Groq's live model list and the rate-limit headers for this key on 2026-11-14. The chat models offered were `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` and `allam-2-7b`.

- **Strict JSON-schema output.** Groq lists `gpt-oss-120b` among the models that support `response_format: json_schema` with `strict: true`. Decoding is constrained to the schema, so invalid JSON should be rare. The app still validates every answer with zod and retries once.
- **Same free limits as the smaller models.** The 120b and 20b models both report 1,000 requests/day and 8,000 tokens/minute on the free tier, so there is no free-tier reason to take the smaller model.
- **Quality.** It is the largest of the free options, which matters for following long extraction rules such as "quote the CV word for word". `reasoning_effort: "low"` keeps its hidden reasoning short, which saves tokens and time.

To switch models, set `LLM_MODEL`; choose one Groq lists for strict structured outputs.

## How the important parts work

- **Grounding check** (`lib/grounding.ts`). Every evidence quote must appear in the CV, compared case-insensitively with all whitespace collapsed. A met or partly met requirement with a missing quote is dropped and counted in `ungrounded_count`. It still counts as *not met* in the score, so an invented quote can never raise the score. Rewrites must quote an existing CV bullet in `original`, and are checked the same way.
- **Rewrite fact check** (an extra safeguard). A rewrite is hidden when it adds a number not in the CV, or a word from the JD that the CV does not contain (for example "Kubernetes"). Hidden rewrites are counted separately as `unsupportedRewriteCount`; they are not stored.
- **Score** (`lib/scoring.ts`). `round(100 × (met + 0.5 × partly met) / all requirements)`. No requirements gives 0.
- **Retries** (`netlify/lib/llm.ts`). HTTP 429 → wait (Groq's `retry-after`, else 2 s then 4 s, max 10 s each) and retry up to 2 times, then "busy, try again in a minute" (503). Invalid JSON → ask once more, then 502.
- **Token budget** (`netlify/lib/analyze.ts`). Groq's free tier rejects any single request over 8,000 tokens per minute. Two 20,000-character inputs are about 10,000 tokens, so the app estimates tokens (4 characters ≈ 1 token) and refuses prompts over 6,000 with a clear message before calling Groq.
- **Rate limit per IP.** Netlify's built-in rate limiting (in each function's `config`) is enforced at the edge in production: 10/min for match, 30/min for feedback, 60/min for stats. A small in-memory limiter does the same per function instance, which also works under `netlify dev`.
- **No user text stored or logged.** The table has no text columns, and the logger accepts only event names and numbers. Tests check that the JD and CV never reach the database parameters or the logs.

## Evaluation method

`eval/cases/` has 10 synthetic JD + CV pairs that I wrote, with no real people:

| Category | Cases | What a good result looks like |
| --- | --- | --- |
| Strong match | 01–03 | score ≥ 70 |
| Weak match | 04–06 | score ≤ 40 |
| Hallucination trap | 07–10 | listed skills must **not** be marked met or partly met: the CV only *wants to learn* them (07), a teammate did the work (08), the CV contains a prompt-injection line (09), or the CV has a similar but different tool (10) |

Run it with your key set:

```bash
npm run eval
```

This runs every case through the same pipeline as `/api/match`, against the real Groq API, but without touching the database. Cases are paced 20 seconds apart to stay inside the free tier's 8,000 tokens/minute. It writes `eval/results.json` and `eval/RESULTS.md`, which record per case:

- schema-valid (after at most one retry) and valid on the first try
- ungrounded quotes, and unsupported rewrites
- latency in milliseconds and the score
- whether the case expectation passed

Results vary from run to run because the model's requirement extraction is not fully deterministic.

## Free-tier limits this depends on

Checked on 2026-11-14. Free tiers change, so re-check before relying on these.

| Service | Free limit that matters here | Effect on this app |
| --- | --- | --- |
| Groq (`openai/gpt-oss-120b`) | 8,000 tokens/minute, 1,000 requests/day (from the API's rate-limit headers) | Each request counts the prompt (instructions + JD + CV, roughly 1 token per 4 characters) plus the answer, so only a few requests fit in each minute. Long inputs are refused before calling Groq. |
| Neon | 100 CU-hours per project per month, 1 GB storage per project, scale to zero after 5 minutes idle; no credit card | Rows are tiny. After idling, the first query wakes the database, which adds a short delay. |
| Netlify (credit-based Free plan) | 300 credits per month. A production deploy costs 15 credits, 10,000 web requests cost 2, and function compute costs 10 per GB-hour. When the credits run out, sites are **paused** until the next cycle (no charge). | About 20 production deploys a month at most. Deploy on purpose rather than on every small push. |
| GitHub Actions | Free for public repositories | CI runs lint, typecheck and tests on every push and pull request. |

## Limitations

- **A quote can be real and still not prove the requirement.** The grounding check proves the quote exists in the CV, not that it supports the requirement. For example, "I would love to learn Kubernetes" could be quoted as *partly met*. The hallucination-trap eval cases measure this.
- **Exact matching is strict.** Typographic differences such as curly versus straight quotes, or different dash characters, make a real quote look ungrounded.
- **The rewrite fact check is a heuristic.** It can hide a fair rewrite that uses a JD word in a harmless way, and it cannot catch invented facts that use words found in neither the JD nor the CV.
- **Scores vary.** The LLM decides how to split the JD into requirements, so the denominator, and therefore the score, can change between runs.
- **The token estimate is rough** (4 characters per token). Text that tokenises badly can still hit Groq's limit; the app then shows the same "too long" message.
- **The in-memory rate limiter is per instance.** Netlify's edge rate limit is the real protection in production.
- **Text leaves your browser.** The JD and CV are sent to Groq to produce the result, under Groq's own data policy. This app does not store or log them.
- Plain text only (no PDF upload), and the prompts are written for English.

## Changes from the original specification

- **Node 22 instead of Node 20.** Node 20 reached end of life on 2026-04-30, and AWS Lambda, which runs Netlify Functions, no longer accepts new Node 20 functions. I agreed this change with the project owner.
- **Token-budget check.** I added this, with the owner's agreement, because the 20,000-character limit per field cannot fit Groq's 8,000 tokens/minute when both fields are full.

## Results

> Placeholders. Fill these in from `eval/RESULTS.md` after running `npm run eval`, and from the stats footer of the deployed site. Do not estimate them.

| Metric | Value |
| --- | --- |
| Eval run date / model | _TBD_ |
| Schema-valid rate (10 cases) | _TBD_ |
| Valid on first try | _TBD_ |
| Mean ungrounded quotes per case | _TBD_ |
| Mean latency (ms) | _TBD_ |
| Expectations met (strong / weak / trap) | _TBD_ |
| Live runs / share with feedback / share helpful | _TBD_ |

## Project layout

```
src/                  React page (App, components, API client, CSS)
lib/                  Shared code: zod schemas, scoring, grounding check, limits
netlify/functions/    match.ts, feedback.ts, stats.ts (one HTTP endpoint each)
netlify/lib/          Server helpers: LLM client, pipeline, prompt, db, logging, rate limit
db/                   SQL migrations
scripts/              Migration runner (npm run migrate)
eval/                 Eval cases, runner and results
tests/                Vitest unit and integration tests
docs/WALKTHROUGH.md   File-by-file explanation and interview questions
```

## License

MIT, see [LICENSE](LICENSE).
