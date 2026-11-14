import type { DisplayStatus, MatchedRequirement, MatchResponse } from "../../lib/schema";
import { Feedback } from "./Feedback";

const STATUS_LABEL: Record<DisplayStatus, string> = {
  met: "Met",
  partly_met: "Partly met",
  not_met: "Not met",
  unverified: "Unverified",
};

const STATUS_ICON: Record<DisplayStatus, string> = {
  met: "✓",
  partly_met: "◐",
  not_met: "✗",
  unverified: "?",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function RequirementList({ items }: { items: MatchedRequirement[] }) {
  return (
    <ul className="requirements">
      {items.map((item, index) => (
        <li key={index} className={`req req-${item.status}`}>
          <div className="req-head">
            <span className="badge">
              <span aria-hidden="true">{STATUS_ICON[item.status]}</span> {STATUS_LABEL[item.status]}
            </span>
            <span className="req-text">{item.requirement}</span>
          </div>
          {item.evidence && (
            <blockquote>
              <span className="visually-hidden">Evidence from your CV: </span>“{item.evidence}”
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  );
}

interface Props {
  result: MatchResponse;
  onFeedbackSent: () => void;
}

export function ResultView({ result, onFeedbackSent }: Props) {
  const checked = result.requirements.filter((r) => r.status !== "unverified");
  const unverified = result.requirements.filter((r) => r.status === "unverified");

  return (
    <section className="results" aria-labelledby="results-heading">
      <h2 id="results-heading">Result</h2>

      {result.score === null ? (
        <p className="score-none">No score: none of the requirements could be checked against your CV.</p>
      ) : (
        <div className="score" role="img" aria-label={`Match score ${result.score} out of 100`}>
          <span className="score-number">{result.score}</span>
          <span className="score-max">/ 100</span>
        </div>
      )}
      <p className="hint">
        Score = met requirements count 1, partly met count 0.5, not met count 0, divided by the{" "}
        {plural(result.scoredCount, "requirement", "requirements")} checked against your CV
        {unverified.length > 0 && <>. {plural(unverified.length, "unverified requirement is", "unverified requirements are")} left out</>}
        {result.traits.length > 0 && <>. {plural(result.traits.length, "personal quality is", "personal qualities are")} not scored</>}.
      </p>

      {result.ungroundedCount > 0 && (
        <p className="notice">
          {plural(result.ungroundedCount, "quote was", "quotes were")} still not found in your CV after a second check.
          Those requirements are listed as unverified and left out of the score, and rewrites based on them are hidden.
        </p>
      )}

      <h3>Requirements</h3>
      {checked.length > 0 ? <RequirementList items={checked} /> : <p>No requirements could be checked.</p>}

      {unverified.length > 0 && (
        <>
          <h3>Unverified</h3>
          <p className="hint">
            The AI said your CV shows these, but the text it quoted is not in your CV, so they could not be checked.
            Look for them in your CV yourself.
          </p>
          <RequirementList items={unverified} />
        </>
      )}

      {result.traits.length > 0 && (
        <>
          <h3>Not checkable from a CV</h3>
          <p className="hint">
            Personal qualities like these cannot be proven by a quote from a CV, so they are not scored. Show them
            through examples in your cover letter or interview.
          </p>
          <ul className="traits">
            {result.traits.map((trait, index) => (
              <li key={index}>{trait}</li>
            ))}
          </ul>
        </>
      )}

      <h3>Gaps</h3>
      {result.gaps.length > 0 ? (
        <ul className="gaps">
          {result.gaps.map((gap, index) => (
            <li key={index}>{gap}</li>
          ))}
        </ul>
      ) : (
        <p>No gaps found.</p>
      )}

      <h3>Suggested CV rewrites</h3>
      {result.rewrites.length > 0 ? (
        <ol className="rewrites">
          {result.rewrites.map((rewrite, index) => (
            <li key={index}>
              <p>
                <span className="label">Original:</span> {rewrite.original}
              </p>
              <p>
                <span className="label">Suggested:</span> {rewrite.rewritten}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p>No rewrites suggested.</p>
      )}
      {result.unsupportedRewriteCount > 0 && (
        <p className="hint">
          {result.unsupportedRewriteCount} suggested {result.unsupportedRewriteCount === 1 ? "rewrite was" : "rewrites were"}{" "}
          hidden because {result.unsupportedRewriteCount === 1 ? "it" : "they"} added facts that are not in your CV.
        </p>
      )}

      <p className="meta">
        Model: {result.model} · {(result.latencyMs / 1000).toFixed(1)} s
      </p>

      {result.id ? (
        <Feedback key={result.id} id={result.id} onSent={onFeedbackSent} />
      ) : (
        <p className="hint">Feedback is unavailable for this result because it could not be saved.</p>
      )}
    </section>
  );
}
