import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_INPUT_CHARS } from "../lib/limits";
import type { MatchResponse, StatsResponse } from "../lib/schema";
import { ApiError, getStats, postMatch } from "./api";
import { ResultView } from "./components/ResultView";
import { StatsFooter } from "./components/StatsFooter";
import { TextInput } from "./components/TextInput";

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; result: MatchResponse };

export function App() {
  const [jd, setJd] = useState("");
  const [cv, setCv] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
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
  const jdOk = jd.trim().length > 0 && jd.length <= MAX_INPUT_CHARS;
  const cvOk = cv.trim().length > 0 && cv.length <= MAX_INPUT_CHARS;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!jdOk || !cvOk || loading) return;
    setStatus({ kind: "loading" });
    try {
      const result = await postMatch(jd, cv);
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
        <header>
          <h1>CV–JD Match</h1>
          <p className="tagline">
            Paste a job description and a CV. Get a match score, evidence quoted from the CV, gaps, and honest rewrite
            ideas.
          </p>
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
          <button type="submit" className="primary" disabled={!jdOk || !cvOk || loading}>
            {loading ? "Matching…" : "Match CV to job"}
          </button>
          {(!jdOk || !cvOk) && !loading && (
            <p className="hint">Fill in both boxes (up to {MAX_INPUT_CHARS.toLocaleString("en-US")} characters each).</p>
          )}
        </form>

        <div ref={resultRef} tabIndex={-1} className="result-area" aria-live="polite">
          {loading && (
            <p className="loading" role="status">
              <span className="spinner" aria-hidden="true" /> Reading the job description and CV… this usually takes a
              few seconds.
            </p>
          )}
          {status.kind === "error" && (
            <p className="error" role="alert">
              {status.message}
            </p>
          )}
          {status.kind === "done" && <ResultView result={status.result} onFeedbackSent={refreshStats} />}
        </div>
      </main>
      <StatsFooter stats={stats} failed={statsFailed} />
    </>
  );
}
