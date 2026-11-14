import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_INPUT_CHARS } from "../lib/limits";
import type { MatchResponse, StatsResponse } from "../lib/schema";
import example from "../eval/cases/12-trap-traits-weak-evidence.json";
import { ApiError, getStats, postMatch } from "./api";
import { ResultView } from "./components/ResultView";
import { StatsFooter } from "./components/StatsFooter";
import { TextInput } from "./components/TextInput";

export const REPO_URL = "https://github.com/nikchey29/cv-jd-match";

// The server does not report progress; these follow the usual order and timing of its steps.
const LOADING_STEPS = ["Reading the job description…", "Quoting evidence from your CV…", "Checking quotes against your CV…"];
const LOADING_STEP_MS = 3500;

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; result: MatchResponse };

export function App() {
  const [jd, setJd] = useState("");
  const [cv, setCv] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);

  const refreshStats = useCallback(() => {
    getStats()
      .then((value) => {
        setStats(value);
        setStatsFailed(false);
      })
      .catch(() => setStatsFailed(true));
  }, []);

  useEffect(refreshStats, [refreshStats]);

  // Move focus to the result or error so keyboard and screen-reader users notice it.
  useEffect(() => {
    if (status.kind === "done" || status.kind === "error") resultRef.current?.focus();
  }, [status.kind]);

  const loading = status.kind === "loading";

  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => setLoadingStep((step) => Math.min(step + 1, LOADING_STEPS.length - 1)), LOADING_STEP_MS);
    return () => clearInterval(timer);
  }, [loading]);
  const jdOk = jd.trim().length > 0 && jd.length <= MAX_INPUT_CHARS;
  const cvOk = cv.trim().length > 0 && cv.length <= MAX_INPUT_CHARS;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!jdOk || !cvOk || loading) return;
    setLoadingStep(0);
    setStatus({ kind: "loading" });
    try {
      // Unedited example runs are not saved, so they do not count in the public stats.
      const result = await postMatch(jd, cv, jd === example.jd && cv === example.cv);
      setStatus({ kind: "done", result });
      refreshStats();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
      setStatus({ kind: "error", message });
    }
  }

  return (
    <>
      <main>
        <header className="site-header">
          <h1>CV–JD Match</h1>
          <p className="tagline">
            Paste a job description and a CV. Get a match score, evidence quoted from the CV, gaps, and honest rewrite
            ideas.
          </p>
          <nav aria-label="Project links">
            <a href={REPO_URL}>GitHub repo</a>
            <a href="#how-it-works">How it works</a>
          </nav>
        </header>

        <p className="privacy">
          <strong>Privacy:</strong> Your text is sent to an LLM to produce the result and is not stored. Only scores and
          feedback are saved.
        </p>

        <form onSubmit={handleSubmit} aria-busy={loading}>
          <div className="inputs">
            <TextInput
              id="jd"
              label="Job description"
              hint="Plain text. Paste the full posting."
              value={jd}
              onChange={setJd}
              disabled={loading}
            />
            <TextInput
              id="cv"
              label="CV"
              hint="Plain text. Copy it from your CV document."
              value={cv}
              onChange={setCv}
              disabled={loading}
            />
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={!jdOk || !cvOk || loading}>
              {loading ? "Matching…" : "Match CV to job"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => {
                setJd(example.jd);
                setCv(example.cv);
              }}
            >
              Try an example
            </button>
          </div>
          {(!jdOk || !cvOk) && !loading && (
            <p className="hint">Fill in both boxes (up to {MAX_INPUT_CHARS.toLocaleString("en-US")} characters each).</p>
          )}
        </form>

        <div ref={resultRef} tabIndex={-1} className="result-area" aria-live="polite">
          {loading && (
            <p className="loading" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>
                {LOADING_STEPS[loadingStep]} <span className="hint">This usually takes a few seconds.</span>
              </span>
            </p>
          )}
          {status.kind === "error" && (
            <p className="error" role="alert">
              {status.message}
            </p>
          )}
          {status.kind === "done" && <ResultView result={status.result} onFeedbackSent={refreshStats} />}
        </div>

        <section id="how-it-works" className="how" aria-labelledby="how-heading">
          <h2 id="how-heading">How it works</h2>
          <ol>
            <li>
              <strong>Extract requirements.</strong> An LLM lists the skills and personal qualities the job asks for.
            </li>
            <li>
              <strong>Quote evidence from the CV.</strong> For each skill it marks met, partly met or not met, and quotes
              the CV line that shows it.
            </li>
            <li>
              <strong>Verify every quote.</strong> Each quote is checked word for word against your CV. Quotes that are
              not found are marked unverified and left out of the score.
            </li>
          </ol>
        </section>
      </main>
      <StatsFooter stats={stats} failed={statsFailed} repoUrl={REPO_URL} />
    </>
  );
}
