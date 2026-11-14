import { useState } from "react";
import { ApiError, postFeedback } from "../api";

interface Props {
  id: string;
  onSent: () => void;
}

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; helpful: boolean } | { kind: "error"; message: string };

/** Thumbs up / down buttons for one result. */
export function Feedback({ id, onSent }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function send(helpful: boolean) {
    setState({ kind: "sending" });
    try {
      await postFeedback(id, helpful);
      setState({ kind: "sent", helpful });
      onSent();
    } catch (error) {
      setState({ kind: "error", message: error instanceof ApiError ? error.message : "Could not send feedback." });
    }
  }

  const chosen = state.kind === "sent" ? state.helpful : null;
  return (
    <div className="feedback" role="group" aria-labelledby="feedback-label">
      <span id="feedback-label">Was this result helpful?</span>
      <button
        type="button"
        onClick={() => send(true)}
        disabled={state.kind === "sending"}
        aria-pressed={chosen === true}
        aria-label="Yes, helpful (thumbs up)"
      >
        <span aria-hidden="true">👍</span>
      </button>
      <button
        type="button"
        onClick={() => send(false)}
        disabled={state.kind === "sending"}
        aria-pressed={chosen === false}
        aria-label="No, not helpful (thumbs down)"
      >
        <span aria-hidden="true">👎</span>
      </button>
      <span aria-live="polite" className="feedback-status">
        {state.kind === "sent" && "Thanks for the feedback."}
        {state.kind === "error" && <span role="alert">{state.message}</span>}
      </span>
    </div>
  );
}
