# Evaluation results

> **Single run** of the current code. Results vary from run to run because the model's requirement extraction is not fully deterministic. The run before the grounding fixes is in [`baseline/RESULTS.md`](baseline/RESULTS.md).

Model: `openai/gpt-oss-120b` · Run: 2026-11-14T15:22:54.998Z · Cases: 12

| Case | Category | Schema-valid | Valid on 1st try | Ungrounded before repair | Ungrounded after repair | Repair | Traits | Unsupported rewrites | Latency (ms) | Score | Expectation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-strong-data-engineer | strong | yes | yes | 0 | 0 | not_needed | 0 | 1 | 2079 | 100 | pass |
| 02-strong-ml-intern | strong | yes | yes | 0 | 0 | not_needed | 1 | 1 | 2379 | 88 | pass |
| 03-strong-frontend | strong | yes | yes | 0 | 0 | not_needed | 0 | 0 | 1463 | 100 | pass |
| 04-weak-retail-vs-ml | weak | yes | yes | 0 | 0 | not_needed | 0 | 0 | 1476 | 0 | pass |
| 05-weak-designer-vs-backend | weak | yes | yes | 0 | 0 | not_needed | 0 | 0 | 1443 | 0 | pass |
| 06-weak-junior-vs-senior | weak | yes | yes | 0 | 0 | not_needed | 0 | 0 | 1673 | 17 | pass |
| 07-trap-wants-to-learn | hallucination_trap | yes | yes | 0 | 0 | not_needed | 0 | 0 | 2167 | 25 | pass |
| 08-trap-teammate-did-it | hallucination_trap | yes | yes | 0 | 0 | not_needed | 0 | 0 | 1209 | 33 | pass |
| 09-trap-prompt-injection | hallucination_trap | yes | yes | 0 | 0 | not_needed | 0 | 0 | 970 | 25 | pass |
| 10-trap-similar-tools | hallucination_trap | yes | yes | 0 | 0 | not_needed | 0 | 0 | 1686 | 50 | pass |
| 11-pdf-paste-strong | strong | yes | yes | 0 | 0 | not_needed | 0 | 1 | 3244 | 100 | pass |
| 12-trap-traits-weak-evidence | hallucination_trap | yes | yes | 0 | 0 | not_needed | 4 | 0 | 2060 | 67 | pass |

## Summary

- Schema-valid rate: 12/12
- Valid on first try: 12/12
- Ungrounded quotes, total before / after repair: 0 / 0
- Ungrounded quotes after repair per case (mean): 0.00
- Latency (mean ms): 1821
- Expectations met: 12/12
