# Jimeng Fast Contract Extraction

Use this loop when continuing Jimeng/Dreamina API reversal. The goal is to implement useful UGC API surface faster by using real captured/provider samples as the seed for schemas, tests, and CLI scaffolds.

## Default Loop

1. Pick the next API family by UGC workflow value: generation, persona/voice, lip-sync, reference controls, template mining, then supporting reads.
2. Run a small bounded live or passive-capture matrix for that family when approved. For generation/mutation, keep concurrency at `1`, record credit balance before/after, and stop on risk-control, auth drift, or unexpected account mutation.
3. Save the raw request/response JSON, normalized summaries, exact commands, credit/spend note, and any media artifacts under ignored `data/**`.
4. Feed the saved JSON/cassettes into a contract-inference step instead of manually writing every field by hand.
5. Generate draft Effect Schema contracts, wrapper functions, CLI flags, endpoint-registry rows, fixtures, and Vitest snapshot tests from the observed contract.
6. Hand-tighten only the relied-on paths and user-facing option semantics. Keep schemas permissive for additive provider fields.
7. Prove backend/API refactors with replayed cassettes, fixtures, typecheck, and Vitest snapshots. Prove media APIs with actual playable/listenable artifacts from the matrix.
8. Update `TASKS.md`, `docs/provider/jimeng-api-triage.md`, and the endpoint registry with implemented, blocked, skipped, or next-probe status.

## Fast Session Algorithm

Use this exact algorithm when a new Codex session resumes the workstream:

1. Read the goal docs and current `git status --short`.
2. Pick one packet from `docs/provider/jimeng-api-triage.md` by product value, not by safety or endpoint count.
3. Write or refresh the packet manifest before code changes. The manifest can be committed as a short doc note or generated under ignored `data/**`; it must name the examples, sample source, output directory, promotion files, acceptance commands, and next handoff.
4. If the packet needs live spend, mutation, fresh capture, unsafe credentials, or visible UI, ask once with the exact command/action list and artifact path. If approved, run the matrix. If not approved, keep working inside the same packet with fixtures, compare gates, request builders, schemas, and tests.
5. Run `contract-infer` or improve it before hand-writing repeated schema/client/test code.
6. Promote generated drafts in one coherent chunk: schema boundary, typed service, CLI command, registry status, fixtures/cassettes, and Vitest snapshots.
7. Verify with replay tests, typecheck, Vitest snapshots, and media/artifact checks only when the packet creates media.
8. End the session with an updated packet handoff: what is promoted, what command proves it, what remains blocked, and the exact next command.

Do not start a session by browsing endpoints manually unless the selected packet has no usable samples, registry rows, or static evidence. Do not switch packets because the current one needs approval; either ask for approval or do adjacent preparation inside that packet.

## Fast Work Packet

Future sessions should treat one API family as one work packet. Do not restart from endpoint discovery unless the packet has no usable samples.

Each packet should have this shape:

```txt
family: persona-voice | lip-sync | reference-controls | template-mining | generation
workflow examples: 2-5 concrete UGC examples we would actually run
live/capture plan: exact commands or UI actions, spend/account risk, output dir
sample set: raw requests/responses, normalized summaries, artifacts, credit before/after
contract output: inferred paths, schema IR, wrapper/CLI draft, registry patch draft
promotion scope: services, CLI commands, fixtures, Vitest snapshots, docs
acceptance: typecheck, unit tests, Vitest snapshots, replay/cassette proof, artifact proof if media
remaining gaps: blocked/unknown endpoints with reason and next probe
```

The packet is the unit of progress. A good session should either finish one packet or leave a packet-local handoff with the exact next command. Avoid scattering partial work across unrelated families.

Minimum packet manifest:

```txt
packet: gen-parity | persona-voice | lip-sync-human | reference-controls | template-mining
why now: one sentence tying it to the UGC product workflow
examples: 2-5 useful examples, with expected media or normalized output
sample source: live | passive-capture | replay | fixture, plus approval status
artifact root: data/jimeng-lab/<packet-run>/
infer command: exact contract-infer command or "not needed because ..."
promotion files: planned source/test/registry/docs files
acceptance commands: focused tests, typecheck, Vitest snapshots
handoff: exact next command if not complete
```

This manifest is the cross-session coordination point. Keep raw JSON, media, signed URLs, and cassettes under ignored `data/**`; commit only redacted summaries, registry status, snapshots, and short QA notes.

Current implementation: `packages/jimeng-client/src/packet-plan.ts` builds value-ranked packet plans and writes schema-validated manifest bundles with `writeJimengPacketPlanOutputs`. A manifest bundle contains `packet-manifest.json`, `packet-manifest.md`, and `approval-prompt.txt` when approval is required. Use `jimeng-browser-proxy packet-plan --packet <id> --outDir data/jimeng-lab/<packet-run>` before making packet code changes so future sessions can resume from the same examples, artifact root, infer command, promotion files, and acceptance commands.

## Scaffold-Then-Promote

The fastest method is to generate scaffolds from saved contracts, then hand-tighten them:

1. Use passive CDP capture, approved live generation, or cassette replay to collect samples.
2. Run `contract-infer` over the sample directory.
3. Generate or update:
   - permissive Effect Schema boundary contracts,
   - typed service methods,
   - Effect CLI command definitions where a command is being rewritten,
   - fixture/cassette replay tests,
   - Vitest snapshots for normalized contract output,
   - endpoint-registry rows and triage notes.
4. Hand edit only the relied-on paths, naming, redaction, and user-facing flags.
5. Delete stale one-off tests or planners if the generated/replay path supersedes them.

Do not manually model every enum value. Capture independent property classes: media kind, generation mode, model key, reference kind, voice source, polling path, artifact download path, and mutation/spend risk. Cosmetic choices like "voice A vs voice B" should be represented as one parameterized flag with a small representative fixture.

## Session Bootstrap

At the start of a new session:

1. Read `docs/plans/jimeng-dreamina-cli-goal.md`, this file, `docs/provider/jimeng-api-triage.md`, and `TASKS.md`.
2. Run `git status --short` and do not stage unrelated dirty files.
3. Run `jimeng-browser-proxy triage-coverage --decisions keep` or inspect the latest snapshot/report to find the highest-value unfinished family.
4. If a packet needs live spend, mutation, visible UI, or fresh capture, ask with the exact command/action, expected artifacts, and credit/account risk.
5. Otherwise work from cassettes/fixtures first, then refresh live only if the contract is missing or stale.

## Tool To Build

Add a reusable contract-inference command before adding more one-off dry-run planners:

```bash
jimeng-browser-proxy contract-infer \
  --input data/jimeng-lab/<proof-run> \
  --endpoint /mweb/v1/aigc_draft/generate \
  --outDir data/jimeng-lab/<proof-run>/contract-infer
```

Expected outputs:

- `contract-summary.json` and `contract-summary.md`
- permissive Effect Schema draft or schema IR for the response/request paths we rely on
- normalized fixture and Vitest snapshot draft
- endpoint-registry patch draft with status, evidence, risks, and next probe
- CLI flag suggestions for independent property classes, not every cosmetic enum value

This tool should redact cookies, auth headers, signed URLs, upload credentials, request ids, timestamps, and other unstable or sensitive values before producing snapshots.

Current status: `jimeng-browser-proxy contract-infer` exists. It scans saved proof/cassette directories, groups JSON by endpoint, redacts/normalizes embedded JSON strings such as `draft_content` and `metrics_extra`, reports stable/frequent contract paths, summarizes artifacts, emits Effect Schema IR, writes registry patch drafts, and is covered by Bun tests plus Vitest snapshots.

`jimeng-browser-proxy generation-contract` now validates and summarizes saved live generation proof result JSON after scaffold inference. It promotes the relied-on `/mweb/v1/aigc_draft/generate` submit/poll/artifact paths into a hand-tightened Effect Schema boundary and compact report so future paid runs can replay against fixtures instead of re-reading raw provider JSON.

## Budget And Safety

- When Arthur approves account spend for exploration, default to at most half of the current remaining credits unless he gives a different cap.
- Keep generation and mutation concurrency at `1`.
- Polling, downloads, local processing, passive capture, and schema inference can run in the background.
- Stop immediately on `ret=1019`, shark/risk-control failures, `429`, auth drift, unexpected paid modal, or unexpected account mutation.
- Never commit raw session bundles, cookies, signed media URLs, generated media, or raw provider credentials.

## Dry-Run Planner Role

Dry-run planners are no longer the primary implementation loop. Use them only when:

- live spend/capture is not approved or not available,
- the planner directly unblocks a high-value family,
- a compare gate is needed before a risky live submit, or
- the request builder is already understood and the planner is a cheap generated artifact.

Do not spend sessions hand-writing low-value planners while an approved bounded matrix plus contract inference would produce schemas, tests, and examples faster.

## Latest Seed Matrix

The 2026-06-12 live matrix is the current seed for this faster loop:

- manifest: `data/jimeng-lab/proof-20260612-live-generation-matrix/manifest.md`
- spent 24 credits, from 3990 to 3966
- generated 1 TTS MP3 and 4 video artifacts
- verified MP4 outputs as H.264, 704x1248, 60 fps, 3.016667 seconds

Future work should use this style of proof bundle as input to contract inference and scaffold generation.

The first scaffold run is saved locally under:

```txt
data/jimeng-lab/proof-20260612-live-generation-matrix/contract-infer/normalized/contract/
```

It was generated with:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts contract-infer \
  --input data/jimeng-lab/proof-20260612-live-generation-matrix \
  --endpoint /mweb/v1/aigc_draft/generate \
  --outDir data/jimeng-lab/proof-20260612-live-generation-matrix/contract-infer
```

The first hand-tightened generation proof report is saved locally under:

```txt
data/jimeng-lab/proof-20260612-live-generation-matrix/generation-contract/normalized/generation-contract/
```

It was generated with:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts generation-contract \
  --input data/jimeng-lab/proof-20260612-live-generation-matrix \
  --outDir data/jimeng-lab/proof-20260612-live-generation-matrix/generation-contract
```

That run validated 4 saved video generation proofs and skipped 0 candidate JSON files.
