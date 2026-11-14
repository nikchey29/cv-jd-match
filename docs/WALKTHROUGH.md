# Walkthrough

This document explains every file in plain language, follows one request from the button click to the database row, and ends with interview questions about the code.

## 1. The big picture

There are three parts:

1. **A web page** (React) where you paste two texts and press a button.
2. **Three small server functions** (Netlify Functions): one does the matching, one saves feedback, one returns stats.
3. **A database table** (Postgres) that stores only numbers about each run, never the texts.

The LLM (on Groq) does the reading and the quoting. Everything that must be trustworthy is done in our own code: the score, the check that quotes really exist, input limits and storage.

## 2. File by file

### Front end (`src/`, `index.html`)

| File | What it does |
| --- | --- |
| `index.html` | The single HTML page. It has an empty `<div id="root">` that React fills in, plus the page title and an inline icon. |
| `src/main.tsx` | Starts React: finds `#root`, renders `<App />` and loads the CSS. |
| `src/App.tsx` | The page itself. It holds state (the two texts, loading/error/result, stats), sends the request when the form is submitted, moves keyboard focus to the result or error, and refreshes the stats footer after a run or feedback. |
| `src/api.ts` | Three small functions that call the back end (`postMatch`, `postFeedback`, `getStats`). They turn any failure into an `ApiError` with a message that is safe to show. |
| `src/components/TextInput.tsx` | A labelled text area with a live "N / 20,000 characters" counter. It marks itself invalid when too long. |
| `src/components/ResultView.tsx` | Shows the score, each requirement with a status badge (icon + word, not colour alone) and its CV quote, the gaps, the rewrites, and notices when items were removed. |
| `src/components/Feedback.tsx` | The thumbs up/down buttons. Uses `aria-pressed` so screen readers know which one is chosen, and shows "Thanks" or an error. |
| `src/components/StatsFooter.tsx` | The footer line: total runs, % with feedback, % helpful, average ungrounded quotes. |
| `src/styles.css` | Plain CSS. Two columns on wide screens and one column under 720 px. 44 px touch targets, visible focus outlines, and 16 px text areas on phones (stops iOS zooming in). |

### Shared code (`lib/`), used by both server and page

| File | What it does |
| --- | --- |
| `lib/limits.ts` | Two constants: 20,000 characters per input and 5 rewrites. Kept separate with no imports, so the browser bundle does not include zod. |
| `lib/schema.ts` | All data shapes. zod schemas check the request bodies and the LLM's answer. `parseLlmOutput` turns raw model text into checked data, or says why it failed (`invalid_json` or `schema_mismatch`). `llmOutputJsonSchema` is the same schema converted to JSON Schema and sent to Groq. It also defines the TypeScript types of the API responses. |
| `lib/scoring.ts` | `computeScore`: met = 1 point, partly met = 0.5, not met = 0, averaged and turned into a whole-number percentage. |
| `lib/grounding.ts` | The grounding check. `normalizeText` lower-cases text and collapses whitespace; `containsQuote` checks that a quote is in the CV. `applyGroundingCheck` drops items whose quote is missing and counts them. `findUnsupportedTerms` catches rewrites that add numbers or JD words the CV does not contain. |

### Server (`netlify/`)

| File | What it does |
| --- | --- |
| `netlify/functions/match.ts` | `POST /api/match`. Rate limit → read JSON → validate with zod → run the pipeline → save a row → return the result. It maps each kind of failure to a clear HTTP status and message. Its dependencies (LLM, database, limiter, clock) are passed into `createMatchHandler`, so tests can swap in fakes. |
| `netlify/functions/feedback.ts` | `POST /api/feedback`. Validates `{id, helpful}` and updates that row; 404 if the id does not exist. |
| `netlify/functions/stats.ts` | `GET /api/stats`. Runs one aggregate SQL query and returns the four numbers. |
| `netlify/lib/analyze.ts` | The core pipeline, shared with the eval script: token-budget check → ask the LLM → if the answer is invalid, ask once more → grounding check → score. It takes the LLM as a function argument (`complete`), which is why tests need no network. |
| `netlify/lib/llm.ts` | Talks to Groq with the `openai` package pointed at Groq's URL. It requests strict JSON-schema output, and turns Groq errors into our own error types (busy, too large, invalid output). `withRateLimitRetry` handles HTTP 429 by waiting and retrying up to 2 times. |
| `netlify/lib/prompt.ts` | The system prompt (the rules for the model) and the function that wraps the JD and CV in tags for the user message. |
| `netlify/lib/db.ts` | The Postgres connection pool, plus three queries: insert a run, set feedback, get stats. `toStats` turns raw counts into shares and is unit tested on its own. |
| `netlify/lib/config.ts` | Reads `GROQ_API_KEY` and `LLM_MODEL` from the environment. |
| `netlify/lib/http.ts` | Helpers to build JSON responses (with `cache-control: no-store`) and to read a JSON body with a size limit. |
| `netlify/lib/log.ts` | The only logger. It accepts event names and numbers/booleans, and `errorKind` reduces an error to its class name and HTTP status, never its message. |
| `netlify/lib/rateLimit.ts` | A fixed-window in-memory limiter: at most N requests per IP per minute, per function instance. |

### Database and scripts

| File | What it does |
| --- | --- |
| `db/001_create_match_runs.sql` | Creates `match_runs`. It has no text columns for the JD or CV, by design, and CHECK constraints keep the numbers sane (score 0–100, counts ≥ 0). |
| `scripts/migrations.ts` | `runMigrations`: applies each `db/*.sql` file once, in name order, inside a transaction, and records it in `schema_migrations`. |
| `scripts/migrate.ts` | The `npm run migrate` command-line wrapper around `runMigrations`. It prints only an error class and code, so connection strings never reach the terminal. |

### Evaluation (`eval/`)

| File | What it does |
| --- | --- |
| `eval/cases/*.json` | 10 synthetic cases: 3 strong, 3 weak, 4 hallucination traps. Each has an `expect` block (score band, or skills that must not be marked met). |
| `eval/run.ts` | `npm run eval`: runs each case through `analyzeMatch` against the real Groq API, paced to stay inside the free tier, and writes `results.json` and `RESULTS.md`. |
| `eval/results.json`, `eval/RESULTS.md` | Output files. They stay empty until the eval is run with a real key. |

### Tests (`tests/`)

| File | What it covers |
| --- | --- |
| `fixtures/llm.ts` | A sample CV and JD, plus mocked LLM answers: good, hallucinated, not JSON, wrong shape, bad status. |
| `fixtures/fakeDb.ts` | A fake database that records SQL and parameters. |
| `scoring.test.ts` | Score maths, rounding, empty list, always 0–100. |
| `grounding.test.ts` | Case and whitespace handling, paraphrases rejected, hallucinated quotes dropped and counted, dropped items scored as not met, rewrite fact check. |
| `schema.test.ts` | Parsing mocked LLM answers (valid, not JSON, truncated, wrong shape, extra fields, too many rewrites); request validation including the 20,000 / 20,001 character boundary. |
| `llm.test.ts` | 429 retry: success after a retry, gives up after 2 retries, honours `retry-after`, caps the wait, no retry on other errors. |
| `analyze.test.ts` | The pipeline with a fake LLM: retry once on invalid JSON, error after two failures, token budget check, prompt contents. |
| `match.test.ts` | The match endpoint: status codes, the saved row's values, no JD/CV text in database parameters or logs, result still returned if saving fails. |
| `feedbackStats.test.ts` | The feedback and stats endpoints, and `toStats`. |
| `rateLimit.test.ts` | The limiter's window and per-key counting. |
| `eval.test.ts` | That there are 10 valid eval cases, plus the expectation checker and Markdown output. |
| `db.integration.test.ts` | Real Postgres (only when `TEST_DATABASE_URL` is set): migration, column list, insert/feedback/stats, constraint check. |

### Configuration

| File | What it does |
| --- | --- |
| `package.json` | Dependencies and scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `migrate`, `eval`). |
| `tsconfig.json` | One strict TypeScript config for the whole repo. `tsc --noEmit` only type-checks; Vite and Netlify do the bundling. |
| `vite.config.ts` | Vite with the React plugin, on port 5173. In Docker it listens on all container interfaces. |
| `vitest.config.ts` | Tells Vitest where the tests are. |
| `eslint.config.js` | ESLint with the TypeScript and React-hooks rules. It bans `console.log`, so logging goes through `logEvent`. |
| `netlify.toml` | Build command, publish directory, functions directory, and how `netlify dev` starts Vite. |
| `.github/workflows/ci.yml` | On every push and pull request: install, lint, typecheck, test, with a Postgres service for the integration tests. |
| `docker-compose.yml` | Local Postgres, a one-off migration container, and the app. |
| `Dockerfile` | Node 22 image that runs `netlify dev --offline`, with a native Deno binary and IPv4-first DNS so `netlify dev` works inside a container. |
| `.env.example` | Variable names only. `.gitignore` keeps `.env` out of git; `.dockerignore` keeps it out of the image. |
| `.nvmrc` | Node version 22, used by CI and Netlify. |

## 3. One request, from button click to database row

1. **Click.** In `App.tsx`, `handleSubmit` stops the normal form submit, checks both boxes are non-empty and at most 20,000 characters, and sets the status to `loading`. The button becomes "Matching…" and a spinner appears.
2. **Fetch.** `postMatch` in `src/api.ts` sends `POST /api/match` with `{ jd, cv }` as JSON.
3. **Routing.** Netlify sees `path: "/api/match"` in `match.ts`'s `config`. In production its edge first applies the per-IP rate limit (10 per minute), then runs the function.
4. **Guard rails** in `createMatchHandler`: the in-memory limiter checks the IP; `readJsonBody` refuses bodies over 100 kB or invalid JSON; `MatchRequestSchema` trims the texts and rejects empty or over-20,000-character input with a 400.
5. **Budget.** `analyzeMatch` estimates prompt tokens (characters ÷ 4). Over 6,000 means a 413 with a "too long for the free tier" message, and Groq is never called.
6. **LLM call.** `buildMessages` puts the rules in the system message and the JD and CV in a user message. `createGroqComplete` calls Groq with `response_format: json_schema` (strict) and `temperature: 0`. On HTTP 429 it waits (Groq's `retry-after`, or 2 s then 4 s, max 10 s) and tries again, at most twice. If Groq is still busy, the user gets a 503 "busy, try again in a minute".
7. **Validation.** `parseLlmOutput` runs `JSON.parse` and then the zod schema. If either fails, `analyzeMatch` asks once more with an extra "reply again with JSON only" message. A second failure gives a 502.
8. **Grounding.** `applyGroundingCheck` looks for each met or partly met evidence quote in the CV (lower-cased, whitespace collapsed). A missing quote drops the item, adds 1 to `ungroundedCount`, and records *not met* for scoring. Rewrites need their `original` to be in the CV, and `rewritten` must not add numbers or JD-only words.
9. **Score.** `computeScore` turns the statuses into 0–100.
10. **Database row.** `saveRun` creates a UUID and runs `INSERT INTO match_runs (id, score, requirement_count, ungrounded_count, latency_ms, model)`; `created_at` defaults to `now()`. The JD and CV are not among the parameters. If the insert fails, the user still gets the result, with `id: null`, so feedback is hidden.
11. **Log and respond.** `logEvent("match_ok", {score, …})` writes one JSON line with numbers only. The function returns 200 with the result.
12. **Render.** `App.tsx` stores the result, `ResultView` draws it, focus moves to the result, and the stats footer refreshes.
13. **Feedback.** Clicking 👍 or 👎 sends `POST /api/feedback {id, helpful}`, which runs `UPDATE match_runs SET helpful = …, feedback_at = now() WHERE id = …`. The footer refreshes from `GET /api/stats`.

## 4. Ten questions an interviewer might ask

**1. Why compute the score in code instead of asking the LLM for it?**
LLM numbers are not reproducible or explainable: the same input can give 72 one time and 80 the next, with no reason. In code the score is a simple formula over the statuses, so I can explain it, test it, and the grounding check can affect it. A dropped hallucination counts as *not met*. The zod schema even rejects a `score` field from the model.

**2. What exactly does the grounding check prove, and what does it not prove?**
It proves each quote exists in the CV, ignoring case and whitespace, so the model cannot invent evidence. It does not prove the quote supports the requirement: "I'd love to learn Kubernetes" is real text but not Kubernetes experience. The hallucination-trap eval cases measure that second kind of error.

**3. Why drop an ungrounded requirement but still score it as not met?**
If it were simply removed, the denominator would shrink and the score could go *up* because of a hallucination. Counting it as not met means an invented quote can never help the candidate's score.

**4. You use strict JSON-schema mode. Why still validate with zod and retry?**
Defence in depth. The model could change, `LLM_MODEL` could point at a model without strict support, or output could be cut off at the token limit. zod is the single source of truth for the shape, and the same schema generates the JSON Schema we send. The retry is cheap insurance.

**5. How do you handle Groq's rate limits?**
There are two kinds. HTTP 429 means "too many right now": we wait (using Groq's `retry-after` header, else exponential backoff), retry up to twice, then return a friendly 503. HTTP 413 means "this single request is bigger than your per-minute token limit": retrying cannot help, so we estimate tokens up front and refuse early with a clear message. The SDK's own retries are turned off so this logic is explicit and tested.

**6. How do you know the CV text is never stored or logged?**
The table has no text columns. The only logger, `logEvent`, takes numbers, booleans and short strings, and errors are reduced to class name and status (Groq's error messages can include account ids). ESLint bans `console.log`. Tests assert that the JD and CV never appear in the database parameters or the log output.

**7. How does the per-IP rate limit work in a serverless app?**
Serverless instances do not share memory, so an in-memory counter is only best-effort. The real limit is Netlify's built-in rate limiting, declared in each function's `config` and enforced at the edge before the function runs. The in-memory limiter is a second layer that also works in local development.

**8. How would you test this without spending API credits?**
The pipeline takes the LLM as a function parameter (dependency injection), so unit tests pass a fake that returns canned strings: valid, invalid JSON, hallucinated quotes. Handlers take their database as a parameter too. Only `npm run eval` uses the real API, on purpose.

**9. What does your evaluation measure, and what are its weaknesses?**
For each of 10 synthetic cases it records: schema validity, ungrounded quote count, latency, score, and whether the case's expectation held (score band, or trap skills not marked met). Weaknesses: 10 cases is small, I wrote the cases myself so they may match my own assumptions, the expectations are coarse, and results vary between runs. Next steps would be more cases, repeated runs with mean and spread, and human-labelled requirement statuses for precision/recall.

**10. What would you change for a production version?**
Measure tokens with a real tokenizer instead of characters ÷ 4. Use fuzzy quote matching (normalise quotes and dashes) while still showing the exact CV text. Add a check that each quote supports its requirement, for example a second LLM pass or an NLI model. Store the prompt version with each row so eval numbers can be compared over time, add accessibility tests in CI, and add a paid LLM fallback for traffic spikes.
