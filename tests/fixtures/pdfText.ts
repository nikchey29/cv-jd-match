// Text as it arrives when a CV is copied out of a PDF viewer: ligature
// characters, soft hyphens, words split at line breaks, bullet glyphs
// (including Word's private-use Symbol bullet), curly quotes, en/em dashes,
// non-breaking and zero-width spaces, and sentences wrapped across lines.
// Escapes are used so every special character is visible in review.

export const PDF_CV =
  "PRIYA NAIR\n" +
  "Machine Learning Engineer\n" +
  "EXPERIENCE\n" +
  "ML Intern, Northwind Analytics   Jun 2024 – Aug 2024\n" +
  "• Fine‑tuned BERT models in PyTorch for support-ticket\n" +
  "classiﬁcation, raising macro-F1 from 0.71 to 0.83.\n" +
  "• Built data pipe-\n" +
  "lines in Python that cleaned 3 million “raw” log lines per day.\n" +
  " Packaged the training code with Docker and tracked ex-\n" +
  "periments in MLﬂow.\n" +
  "▪ Wrote an inter­nal guide on model evaluation for the team’s analysts.\n" +
  "● Led a data-\n" +
  "driven review of labelling errors.\n" +
  "PROJECTS\n" +
  "◦ Sentiment classiﬁer for product reviews — Python, scikit-learn,​ FastAPI.\n" +
  "SKILLS\n" +
  "Python · PyTorch · SQL · Docker · MLflow";

/** Quotes as a model writes them: plain ASCII, words joined, one line. */
export const PDF_QUOTES = {
  wrappedSentence: "Fine-tuned BERT models in PyTorch for support-ticket classification",
  ligatureAndNumbers: "raising macro-F1 from 0.71 to 0.83",
  lineBreakHyphen: "Built data pipelines in Python that cleaned 3 million",
  curlyQuotes: 'cleaned 3 million "raw" log lines per day',
  privateUseBullet: "Packaged the training code with Docker and tracked experiments in MLflow.",
  softHyphenAndApostrophe: "Wrote an internal guide on model evaluation for the team's analysts",
  realHyphenAtLineBreak: "Led a data-driven review of labelling errors",
  emDashAndNbsp: "Sentiment classifier for product reviews - Python, scikit-learn, FastAPI",
  enDashDates: "Jun 2024 - Aug 2024",
  middleDotSkills: "Python PyTorch SQL",
} as const;
