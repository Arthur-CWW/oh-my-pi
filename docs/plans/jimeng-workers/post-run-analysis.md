# Jimeng Worker Post-Run Analysis

Repo: `/Users/arthur/projects/pi-web-access`

Mode: analysis. Prefer read-only unless explicitly asked to update docs.

## Read First

- `docs/plans/jimeng-workers/README.md`
- `docs/plans/jimeng-workers/session-log.md`
- `docs/plans/jimeng-workers/parent-monitoring-runbook.md`
- worker result files under `data/jimeng-lab/worker-results/`, if present
- `agent://<id>` final output artifacts, if available
- `history://<id>` transcripts, if available
- OMP task/job metadata, if accessible

## Task

Analyze the completed Jimeng worker wave and produce a process/cost report.

## Questions

1. What did each worker accomplish?
2. Which worker outputs were accepted, edited, rejected, or deferred?
3. How long did each worker take?
4. How many tokens did each worker use?
5. What did each worker cost?
6. What was the total cost of the parallel wave?
7. What was the wall-clock speedup versus doing the same work serially?
8. Which prompts were too vague or too broad?
9. Which file ownership rules prevented conflicts?
10. Which validation gates caught issues?
11. Which validation gates were missing?
12. Which worker should have been implementation versus read-only, or vice versa?
13. What should change in the next wave's worker briefs?

## Metrics To Extract

For each session, extract if available:

- session id
- model/provider
- thinking level
- start time
- end time
- duration
- input tokens
- output tokens
- cached tokens
- tool call count
- bash command count
- files read
- files edited
- tests run
- test result
- estimated cost
- final status
- integration outcome

Use `unknown` where the trace does not expose a metric. Do not fabricate numbers.

## Output

Write:

```txt
data/jimeng-lab/worker-results/wave1-post-run-analysis.md
```

Include:

- executive summary
- per-worker table
- aggregate cost/time table
- quality findings
- prompt/process improvements
- recommended wave 2 worker split
- exact doc updates recommended

Do not include credentials, cookies, signed URLs, raw provider responses, or private media.
