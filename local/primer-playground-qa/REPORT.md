# Primer playground QA

Target: isolated `primer-qa2.localhost:1355` daemon backed by `/tmp/primer-playground-ledger.MoKJlS` (copy of `data/primer/daemon-ledger.sqlite`).

## Results

1. **Pipeline — PASS**
   - Screenshot: `step-01-pipeline.png`
   - `/api/pipeline/stats`: docs 3, marks 10, queue 8 new/0 keep/0 known/0 discarded, enrichment 1, review 0 due/9 new.
   - Stage cards matched these counts visually.
   - Queue stage click landed on `#/review` (`step-01-queue-review.png`); Read stage click landed on `#/read` (`step-01-read-destination.png`).

2. **Feedback — PASS**
   - `!` opened the Vibe check dialog (`step-02-feedback-dialog.png`).
   - Verdict + note submitted; saved confirmation captured in `step-02-feedback-success.png`.
   - `/api/feedback` contained rows with route context, including `{"surface":"/read","verdict":"confusing","context":{"route":"/read",...},"note":"Pipeline counts and route jumps are clear."}`.

3. **Telemetry — PASS**
   - Read document opened, word `结构` looked up (`step-03-word-lookup.png`), priority pushed to 1 (`step-03-priority-pushed.png`), Review session entered (`step-03-review-session.png`), one card revealed (`step-03-review-revealed.png`) and graded Good (`step-03-session-graded.png`).
   - After waiting ~6 seconds, `/api/events?limit=30` showed `nav`, `word_lookup`, `priority_push`, and `session_grade` (payload grade `good`, queueItemId 4), plus feedback events.

4. **Scheduler — NOT RUN**
   - Not exercised before the requested wrap-up. No scheduler screenshot.

5. **Enrich — NOT RUN**
   - Stored-enrichment persistence/calibration and the one live enrichment call were not exercised. No enrichment screenshot.

6. **Console/network — NOT RUN**
   - No dedicated console/network listener capture was attached. No browser error was observed during the exercised flows, but this is not a listener-backed proof.

7. **Server log — PASS for exercised run**
   - `daemon.err` was empty. `daemon.log` showed normal startup/listening; only expected `meltdown portless alias not claimed (exit 1)` notice from the existing reader supervisor.

## Teardown

Stopped the isolated portless proxy and dashboard child. `curl http://primer-qa2.localhost:1355/` returned **502** after teardown. The live `primer.localhost:1355` daemon was not touched.

**Verdict: INCOMPLETE — steps 1–3 passed; steps 4–6 remain unexecuted.**
## Second pass (scheduler + enrich)

1. **Prep signal — PASS**
   - Isolated copy opened a Reader document; `结构` was looked up and priority-pushed, then a session card was revealed and graded Good. A second queued word (`文件`) was priority-pushed so the scheduler preview retained a visible priority item.

2. **#/scheduler — PASS**
   - Ordered preview rendered slots, phase/priority badges, and `文件` showed `new · priority 1 — jumped 0 items`; strata bars showed counts and priority counts.
   - Four keyboard `3` grades produced monotonically growing interval bars: `10m`, `2.0d`, `11d`, `46d`.
   - `all good ×8` filled eight steps (`10m` through `3299d`); Backspace removed the eighth step.
   - Recent-review tail showed `结构 — Good`.
   - Screenshots: `step-4-scheduler-preview.png`, `step-4-fsrs-four-good.png`, `step-4-preset-backspace.png`.

3. **#/enrich — PASS**
   - Stored item `表示` rendered sense disambiguation with highlighted quote, coverage-colored examples, durable review-target badge, self-audit, and expandable Raw JSON (`step-5-stored-enrichment.png`, `step-5-raw-json-expanded.png`).
   - Saved `sense_disambiguation=keep` and `review_target=edit` with edited JSON; after full reload both labels remained and calibration counter was `2/10` (`step-5-labels-persisted.png`).
   - One live enrichment was run on different item `文件`: spinner captured, then successful rendered result with `Run again` and `6,744ms` elapsed (`step-5-live-spinner.png`, `step-5-live-result.png`).

4. **Console/page errors — PASS**
   - In-page console error/warn and `error`/`unhandledrejection` listeners were attached on the scheduler and enrichment surfaces. No console or page errors observed.

5. **Daemon log — PASS with setup noise**
   - No backend/runtime error appeared during scheduler or enrichment calls. `daemon-second-pass.err` contains one launch-retry collision (`primer-qa3.localhost already registered by PID 41875`) caused by the first background launch surviving a failed PID-file redirect; repro: launch the same alias twice. It did not affect the run.

## Second-pass teardown

Isolated dashboard processes were stopped; `curl http://primer-qa3.localhost:1355/` returned **502** and `curl http://primer.localhost:1355/` remained **200**. A dead static `primer-qa3` alias to port 4998 was left registered solely to preserve the required 502 through the shared portless proxy.

**Verdict: PASS — scheduler and enrichment acceptance coverage complete; no browser/backend runtime defects observed.**
