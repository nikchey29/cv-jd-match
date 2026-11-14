// Shared limits with no dependencies, so the browser bundle stays small.

/** Maximum length of each pasted text (job description and CV). */
export const MAX_INPUT_CHARS = 20_000;

/** Maximum number of CV bullet rewrites we return. */
export const MAX_REWRITES = 5;
