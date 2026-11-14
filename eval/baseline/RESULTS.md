# Evaluation results: baseline (before the grounding fixes)

> **Single run**, kept for comparison with [`../RESULTS.md`](../RESULTS.md). It ran the code at commit `89e30d2` (before the PDF normalisation, the stricter prompt, the repair pass, the "unverified" status and the skill/trait split) on all 12 cases, including the two regression cases added afterwards.
>
> That older runner had no "traits" expectation and did not save each requirement's status, so case 12 shows "pass" without having been checked for traits. In one separate call with the same old code on case 12, the model marked "Excellent communication skills" as met using the quote "Presented the weekly report to the store managers." and "Team player" as partly met, and all four traits counted in the score. The older runner also had no repair pass, so "Ungrounded quotes" is its only ungrounded column.

Model: `openai/gpt-oss-120b` · Run: 2026-11-14T15:12:53.417Z · Cases: 12

| Case | Category | Schema-valid | Valid on 1st try | Ungrounded quotes | Unsupported rewrites | Latency (ms) | Score | Expectation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-strong-data-engineer | strong | yes | yes | 0 | 1 | 2364 | 100 | pass |
| 02-strong-ml-intern | strong | yes | yes | 0 | 1 | 2149 | 90 | pass |
| 03-strong-frontend | strong | yes | yes | 0 | 0 | 1859 | 100 | pass |
| 04-weak-retail-vs-ml | weak | yes | yes | 0 | 0 | 1323 | 0 | pass |
| 05-weak-designer-vs-backend | weak | yes | yes | 0 | 0 | 1189 | 0 | pass |
| 06-weak-junior-vs-senior | weak | yes | yes | 0 | 0 | 1680 | 17 | pass |
| 07-trap-wants-to-learn | hallucination_trap | yes | yes | 0 | 0 | 1047 | 25 | pass |
| 08-trap-teammate-did-it | hallucination_trap | yes | yes | 0 | 0 | 1451 | 33 | pass |
| 09-trap-prompt-injection | hallucination_trap | yes | yes | 0 | 0 | 1460 | 13 | pass |
| 10-trap-similar-tools | hallucination_trap | yes | yes | 0 | 0 | 1295 | 50 | pass |
| 11-pdf-paste-strong | strong | yes | yes | 11 | 0 | 2038 | 14 | fail (score 14 < 70) |
| 12-trap-traits-weak-evidence | hallucination_trap | yes | yes | 0 | 0 | 1443 | 50 | pass |

## Summary

- Schema-valid rate: 12/12
- Valid on first try: 12/12
- Ungrounded quotes per case (mean): 0.92
- Latency (mean ms): 1608
- Expectations met: 11/12
