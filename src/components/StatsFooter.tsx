import type { StatsResponse } from "../../lib/schema";

function percent(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

interface Props {
  stats: StatsResponse | null;
  failed: boolean;
  repoUrl: string;
}

const PORTFOLIO_URL = "https://chaithanyavemuri.xyz/";

/** Live usage numbers from /api/stats. */
export function StatsFooter({ stats, failed, repoUrl }: Props) {
  let content: string;
  if (failed) content = "Usage stats are unavailable right now.";
  else if (!stats) content = "Loading usage stats…";
  else
    content =
      `${stats.totalRuns.toLocaleString("en-US")} runs · ` +
      `${percent(stats.feedbackShare)} with feedback · ` +
      `${percent(stats.helpfulShare)} rated helpful · ` +
      `${stats.avgUngrounded === null ? "–" : stats.avgUngrounded.toFixed(2)} ungrounded quotes per run on average`;

  return (
    <footer className="stats">
      <h2 className="visually-hidden">Usage statistics</h2>
      <p aria-live="polite">{content}</p>
      <p>
        Built by Chaithanya Vemuri · <a href={repoUrl}>GitHub repo</a> · <a href={PORTFOLIO_URL}>Portfolio</a>
      </p>
    </footer>
  );
}
