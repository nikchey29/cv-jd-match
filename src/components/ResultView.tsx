import type { MatchResponse, RequirementStatus } from "../../lib/schema";
import { Feedback } from "./Feedback";

const STATUS_LABEL: Record<RequirementStatus, string> = {
  met: "Met",
  partly_met: "Partly met",
  not_met: "Not met",
};

const STATUS_ICON: Record<RequirementStatus, string> = {
  met: "✓",
  partly_met: "◐",
  not_met: "✗",
};

interface Props {
  result: MatchResponse;
  onFeedbackSent: () => void;
}

export function ResultView({ result, onFeedbackSent }: Props) {
  return (
    <section className="results" aria-labelledby="results-heading">
      <h2 id="results-heading">Result</h2>

      <div className="score" role="img" aria-label={`Match score ${result.score} out of 100`}>
        <span className="score-number">{result.score}</span>
        <span className="score-max">/ 100</span>
      </div>
      <p className="hint">
        Score = met requirements count 1, partly met count 0.5, divided by all {result.requirementCount} requirements
        found in the job description.
      </p>

      {result.ungroundedCount > 0 && (
        <p className="notice">
          {result.ungroundedCount} {result.ungroundedCount === 1 ? "item was" : "items were"} removed because the quoted
          evidence was not found in your CV. Removed requirements count as not met.
        </p>
      )}

      <h3>Requirements</h3>
      <ul className="requirements">
        {result.requirements.map((item, index) => (
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
