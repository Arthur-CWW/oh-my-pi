> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-06-24T23-50-40-591Z_019efc0b-02cf-7000-ae2e-f5e621ce3b9b/local/self-improvement/grid-spec.md

# Self-Improvement Extraction Grid Spec

Extract lessons into these lanes:

1. `user_preferences`: durable Arthur preferences and non-functional requirements.
2. `assistant_mistakes`: recurring assistant failure modes.
3. `tool_misuse`: wrong tool, wrong surface, blocked browser/computer-use behavior, shell misuse, no specialized tool.
4. `harness_guardrails`: OMP/Pi/Codex harness, system prompt, managed skills, lint, AST-grep, automatic guardrails.
5. `testing_proof`: verification style, proof artifacts, test scope, fake proof risks.
6. `subagent_contracts`: packet/workstream contracts, ownership, DAG dependencies, handoff schema, reviewer/fix loops.
7. `stt_aliases`: speech-to-text aliases and pronunciation drift, e.g. Jimeng/Gming/Gmaong, CuaDriver/cooler driver/cuadriver/C-U-A driver, OMP/oh my pi, Codex/codex, Kagi, Grok, Slotok, Pleometric.
8. `user_prompt_gaps`: non-obvious requirements Arthur may need to specify when the harness cannot infer them.

Every extracted lesson must include: lane, severity (`blocker|important|preference|nice`), imperative rule, evidence session keys/ids, suggested fix surface (`prompt|managed_skill|harness|tool_schema|lint|test|sqlite_pipeline|user_prompt_template`), and confidence (`low|medium|high`).

Quality settings:
- `low`: fast broad recall; favor coverage over nuance.
- `medium`: balanced extraction; merge duplicates inside the chunk.
- `high`: skeptical extraction; include only recurring/evidence-backed issues and separate similar lanes.
- `xhigh`: adversarial extraction; identify hidden failure classes, prompt/harness/tool fixes, and user prompt gaps; avoid overfitting one-offs.

Output JSON only with shape:
{
  "chunk_uri": string,
  "setting": string,
  "sessions_checked": string[],
  "lessons": [{"lane": string, "severity": string, "rule": string, "evidence": string[], "fix_surface": string[], "confidence": string}],
  "stt_aliases": [{"spoken_or_mistranscribed": string, "canonical": string, "evidence": string[], "suggested_dictionary_entry": string}],
  "quality_notes": {"miss_risks": string[], "best_use": string}
}
