// Mocked LLM responses and texts used by the unit tests. No network calls.

export const CV = `Jane Doe — Data Engineer
- Built ETL pipelines in Python and SQL at Acme, processing 2 million rows per day.
- Deployed models with   Docker on AWS.
- Mentored two junior analysts.`;

export const JD = `We need a data engineer with Python, SQL, Docker and Kubernetes.
Experience with Airflow is a plus.`;

/** A well-formed response whose quotes all appear in CV. */
export const GOOD_OUTPUT = {
  requirements: [
    { requirement: "Python", kind: "skill", status: "met", evidence: "Built ETL pipelines in Python and SQL at Acme" },
    // Different case and whitespace than the CV: must still be grounded.
    { requirement: "Docker", kind: "skill", status: "met", evidence: "deployed models with docker on AWS" },
    { requirement: "SQL", kind: "skill", status: "partly_met", evidence: "Python and SQL" },
    { requirement: "Kubernetes", kind: "skill", status: "not_met", evidence: "" },
  ],
  gaps: ["No Kubernetes experience", "No Airflow experience"],
  rewrites: [
    {
      original: "Mentored two junior analysts.",
      rewritten: "Mentored two junior analysts on Python and SQL practices.",
    },
  ],
};

/** A response where the model invented a quote and a rewrite source. */
export const HALLUCINATED_OUTPUT = {
  requirements: [
    { requirement: "Python", kind: "skill", status: "met", evidence: "Built ETL pipelines in Python and SQL at Acme" },
    { requirement: "Kubernetes", kind: "skill", status: "met", evidence: "Managed Kubernetes clusters in production" },
  ],
  gaps: [],
  rewrites: [
    { original: "Led a team of ten engineers.", rewritten: "Led and grew a team of ten engineers." },
  ],
};

export const GOOD_RAW = JSON.stringify(GOOD_OUTPUT);
export const HALLUCINATED_RAW = JSON.stringify(HALLUCINATED_OUTPUT);
export const NOT_JSON_RAW = "Sure! Here is the analysis: the candidate is a strong match.";
export const WRONG_SHAPE_RAW = JSON.stringify({ score: 92, summary: "Strong match" });
export const BAD_STATUS_RAW = JSON.stringify({
  ...GOOD_OUTPUT,
  requirements: [{ requirement: "Python", kind: "skill", status: "yes", evidence: "Python" }],
});
