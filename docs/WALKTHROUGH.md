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
| `src/components/ResultView.tsx` | Shows the score (or "No score" when nothing could be checked) with the formula, the checked requirements with a status badge (icon + word, not colour alone) and their CV quote, an "Unverified" section, a "Not checkable from a CV" list of traits, the gaps, the rewrites, and notices about quotes still not found. |
| `src/components/Feedback.tsx` | The thumbs up/down buttons. Uses `aria-pressed` so screen readers know which one is chosen, and shows "Thanks" or an error. |
| `src/components/StatsFooter.tsx` | The footer line: total runs, % with feedback, % helpful, average ungrounded quotes. |
| `src/styles.css` | Plain CSS. Two columns on wide screens and one column under 720 px. 44 px touch targets, visible focus outlines, and 16 px text areas on phones (stops iOS zooming in). |

### Shared code (`lib/`), used by both server and page

| File | What it does |
| --- | --- |
| `lib/limits.ts` | Two constants: 20,000 characters per input and 5 rewrites. Kept separate with no imports, so the browser bundle does not include zod. |
| `lib/schema.ts` | All data shapes. zod schemas check the request bodies and the LLM's answer. `parseLlmOutput` turns raw model text into checked data, or says why it failed (`invalid_json` or `schema_mismatch`). `llmOutputJsonSchema` is the same schema converted to JSON Schema and sent to Groq. It also defines the TypeScript types of the API responses. |
| `lib/scoring.ts` | `computeScore`: met = 1 point, partly met = 0.5, not met = 0, averaged over the checked requirements and turned into a whole-number percentage. Unverified requirements and traits are never passed in. An empty list gives `null` (no score). |
| `lib/grounding.ts` | The grounding check. `normalizeText` applies NFKC, removes soft hyphens and zero-width characters, makes quotes and dashes plain, joins words split at a line break, turns bullets into spaces, collapses whitespace and lower-cases. `containsQuote` checks that a quote is in the CV after that, ignoring punctuation at its ends. `applyGroundingCheck` sets traits apart, marks skills whose quote is still missing as `unverified` and counts them, hides rewrites with a missing `original`, and hides rewrites that add facts (`findUnsupportedTerms`). |
| `lib/repair.ts` | The pure half of the repair pass. `findUngroundedQuotes` lists the skill evidence and rewrite originals not found in the CV; `applyRepairAnswers` uses a corrected quote only if it is in the CV, and treats `"none"` as withdrawing the claim. |

### Server (`netlify/`)

| File | What it does |
| --- | --- |
| `netlify/functions/match.ts` | `POST /api/match`. Rate limit → read JSON → validate with zod → run the pipeline → save a row → return the result. It maps each kind of failure to a clear HTTP status and message. Its dependencies (LLM, database, limiter, clock) are passed into `createMatchHandler`, so tests can swap in fakes. |
| `netlify/functions/feedback.ts` | `POST /api/feedback`. Validates `{id, helpful}` and updates that row; 404 if the id does not exist. |
| `netlify/functions/stats.ts` | `GET /api/stats`. Runs one aggregate SQL query and returns the four numbers. |
| `netlify/lib/analyze.ts` | The core pipeline, shared with the eval script: token-budget check → ask the LLM → if the answer is invalid, ask once more → if any quote is not in the CV, one repair call listing only those items (skipped after 30 s, and never fatal) → grounding check → score. It takes the LLM as a function argument, so tests can pass a fake. |
| `netlify/lib/llm.ts` | Talks to Groq with the `openai` package pointed at Groq's URL. It requests strict JSON-schema output, and turns Groq errors into our own error types (busy, too large, invalid output). `withRateLimitRetry` handles HTTP 429 by waiting and retrying up to 2 times. |
| `netlify/lib/prompt.ts` | The system prompt (verbatim evidence of at most 25 words, no ellipsis or paraphrase, `kind` skill or trait), the function that wraps the JD and CV in tags, and the repair prompt and messages (the CV plus only the failed items). |
| `netlify/lib/db.ts` | The Postgres connection pool, plus three queries: insert a run, set feedback, get stats. `toStats` turns raw counts into shares and is unit tested on its own. |
| `netlify/lib/config.ts` | Reads `GROQ_API_KEY` and `LLM_MODEL` from the environment. |
| `netlify/lib/http.ts` | Helpers to build JSON responses (with `cache-control: no-store`) and to read a JSON body with a size limit. |
| `netlify/lib/log.ts` | The only logger. It accepts event names and numbers/booleans, and `errorKind` reduces an error to its class name and HTTP status, never its message. |
| `netlify/lib/rateLimit.ts` | A fixed-window in-memory limiter: at most N requests per IP per minute, per function instance. |

### Database and scripts

| File | What it does |
| --- | --- |
| `db/001_create_match_runs.sql` | Creates `match_runs`. It has no text columns for the JD or CV, by design, and CHECK constraints keep the numbers sane (score 0–100, counts ≥ 0). |
| `db/002_score_nullable_and_ungrounded_meaning.sql` | Allows a NULL score (nothing could be checked) and documents that `ungrounded_count` now counts quotes still not found after the repair pass. |
| `scripts/migrations.ts` | `runMigrations`: applies each `db/*.sql` file once, in name order, inside a transaction, and records it in `schema_migrations`. |
| `scripts/migrate.ts` | The `npm run migrate` command-line wrapper around `runMigrations`. It prints only an error class and code, so connection strings never reach the terminal. |

### Evaluation (`eval/`)

| File | What it does |
| --- | --- |
| `eval/cases/*.json` | 12 synthetic cases: 3 strong, 3 weak, 4 hallucination traps, and 2 regression cases (a CV pasted from a PDF, and a JD full of traits). Each has an `expect` block: score band, skills that must not be marked met, a maximum of still-ungrounded quotes, or keywords that must be listed as traits. |
| `eval/run.ts` | `npm run eval`: runs each case through `analyzeMatch` against the real Groq API, paced to stay inside the free tier, and writes `results.json` and `RESULTS.md`. |
| `eval/results.json`, `eval/RESULTS.md` | Output files. They stay empty until the eval is run with a real key. |

### Tests (`tests/`)

| File | What it covers |
| --- | --- |
| `fixtures/llm.ts` | A sample CV and JD, plus mocked LLM answers: good, hallucinated, not JSON, wrong shape, bad status. |
| `fixtures/pdfText.ts` | A CV as it arrives when copied from a PDF (ligatures, soft hyphens, split words, bullet glyphs, curly quotes, dashes, odd spaces) and the clean quotes a model would write. |
| `fixtures/fakeDb.ts` | A fake database that records SQL and parameters. |
| `scoring.test.ts` | Score maths, rounding, empty list gives no score, always 0–100. |
| `grounding.test.ts` | Each normalisation rule; every clean quote found in the PDF-pasted CV; paraphrases and ellipsis quotes still rejected; unverified items left out of the score; traits set apart; rewrite fact check. |
| `repair.test.ts` | Which items go to the repair pass, how answers are applied, one call with only the failed items, re-checking, `"none"`, invalid answer, rate-limited repair, the 30 s skip, traits never repaired. |
| `prompt.test.ts` | The evidence and skill/trait rules are in the prompt; the user message format. |
| `schema.test.ts` | Parsing mocked LLM answers (valid, not JSON, truncated, wrong shape, extra fields, too many rewrites, missing or bad `kind`); the strict JSON Schema; request validation including the 20,000 / 20,001 character boundary. |
| `llm.test.ts` | 429 retry: success after a retry, gives up after 2 retries, honours `retry-after`, caps the wait, no retry on other errors. With a fake `fetch`: the match and repair schemas and token limits sent to Groq, and 429 handling on the repair call. |
| `analyze.test.ts` | The pipeline with a fake LLM: retry once on invalid JSON, error after two failures, token budget check, prompt contents. |
| `match.test.ts` | The match endpoint: status codes, the saved row's values (including `ungrounded_count` after repair and a NULL score), no JD/CV text in database parameters or logs, result still returned if saving fails. |
| `feedbackStats.test.ts` | The feedback and stats endpoints, and `toStats`. |
| `rateLimit.test.ts` | The limiter's window and per-key counting. |
| `eval.test.ts` | That there are 12 valid eval cases, that the regression cases contain what they claim, plus the expectation checker and Markdown output. |
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
8. **Repair pass.** `findUngroundedQuotes` normalises the CV and each met or partly met skill quote and rewrite `original` (NFKC, quotes, dashes, soft hyphens, split words, bullets, whitespace) and lists the ones not found. If there are any, and less than 30 s have passed, one more call sends the CV and only those items, using a small strict schema, and asks for a verbatim quote or `"none"`. A corrected quote is used only if it is really in the CV; `"none"` makes the requirement *not met* or removes the rewrite. If this call fails (even after the 429 retries), the request carries on without it.
9. **Grounding.** `applyGroundingCheck` puts traits in their own list, marks any skill whose quote is still missing as *unverified* (no quote shown, added to `ungroundedCount`, left out of the score), and hides rewrites whose `original` is missing or whose `rewritten` adds numbers or JD-only words.
10. **Score.** `computeScore` turns the statuses of the checked skills into 0–100, or `null` if none are left.
11. **Database row.** `saveRun` creates a UUID and runs `INSERT INTO match_runs (id, score, requirement_count, ungrounded_count, latency_ms, model)`; `created_at` defaults to `now()`. `ungrounded_count` is the count after the repair pass. The JD and CV are not among the parameters. If the insert fails, the user still gets the result, with `id: null`, so feedback is hidden.
12. **Log and respond.** `logEvent("match_ok", {score, …})` writes one JSON line with numbers only, including the ungrounded count before and after repair and the repair outcome. The function returns 200 with the result.
13. **Render.** `App.tsx` stores the result, `ResultView` draws it, focus moves to the result, and the stats footer refreshes.
14. **Feedback.** Clicking 👍 or 👎 sends `POST /api/feedback {id, helpful}`, which runs `UPDATE match_runs SET helpful = …, feedback_at = now() WHERE id = …`. The footer refreshes from `GET /api/stats`.

## 4. Ten questions an interviewer might ask

**1. Why compute the score in code instead of asking the LLM for it?**
LLM numbers are not reproducible or explainable: the same input can give 72 one time and 80 the next, with no reason. In code the score is a simple formula over the statuses, so I can explain it, test it, and the grounding check can affect it. An unverified claim is left out of the score entirely. The zod schema even rejects a `score` field from the model.

**2. What exactly does the grounding check prove, and what does it not prove?**
It proves each quote exists in the CV, after normalising the differences a PDF paste introduces (case, whitespace, ligatures, quotes, dashes, split words, bullets), so the model cannot invent evidence. It does not prove the quote supports the requirement: "I'd love to learn Kubernetes" is real text but not Kubernetes experience. The hallucination-trap eval cases measure that second kind of error.

**3. Why mark a still-ungrounded requirement "unverified" and leave it out of the score?**
A missing quote does not tell us the candidate lacks the skill: real CVs pasted from PDFs often defeated exact matching, and 10 of 18 items were once dropped on a real CV. So the app first normalises PDF artefacts, then gives the model one repair call for just the failed quotes. Whatever is still unproven is neither evidence for nor against the candidate, so it leaves both the numerator and the denominator, and the user sees it in its own section. An invented quote still can never raise the score. If the model answers "none" in the repair pass, it has withdrawn the claim, and that requirement counts as not met.

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
For each of 12 synthetic cases it records: schema validity, ungrounded quotes before and after the repair pass, the repair outcome, the number of traits, latency, score, and whether the case's expectation held (score band, trap skills not marked met, no quotes left ungrounded on the PDF case, traits listed apart). Weaknesses: 12 cases is small, I wrote the cases myself so they may match my own assumptions, the expectations are coarse, and results vary between runs. Next steps would be more cases, repeated runs with mean and spread, and human-labelled requirement statuses for precision/recall.

**10. What would you change for a production version?**
Measure tokens with a real tokenizer instead of characters ÷ 4. Highlight the matched span in the user's own CV text, so they can see exactly where each quote came from. Add a check that each quote supports its requirement, for example a second LLM pass or an NLI model. Store the prompt version with each row so eval numbers can be compared over time, add accessibility tests in CI, and add a paid LLM fallback for traffic spikes.
