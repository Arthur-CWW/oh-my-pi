# Anthropic Usage Policy — Fable guardrails

Extracted 2026-07-03 from https://www.anthropic.com/legal/aup. This is the subset that actually constrains our work. Anything not listed here is fine.

## What blocks Fable

| Category | What's prohibited | Our exposure |
|---|---|---|
| **Cybersecurity** | Exploit/vuln discovery without owner auth, malware, unauthorized access tools, bypassing security controls, social engineering tools | `godmode.ts` (archived), `reveng` skill (archived), any tool that bypasses platform auth/rate-limits |
| **Jailbreaking** | "Intentionally bypass capabilities, restrictions, or guardrails… for the purposes of instructing the model to produce harmful outputs (e.g., jailbreaking or prompt injection) without prior authorization" | `godmode.ts` jailbreak templates (archived). Do not build or test jailbreak prompts. |
| **Platform circumvention** | "Engage in actions or behaviors that circumvent the guardrails or terms of other platforms or services" | Any scraper that bypasses rate-limits, WAF, CAPTCHAs, or impersonates official clients. The emusks private-API research lane was borderline (archived). Browser automation against logged-in sessions is fine *if* it operates as a normal user — no header spoofing, no token extraction, no rate-limit bypass. |
| **Privacy** | Collecting personal info without consent, facial recognition, tracking location/emotions without consent | Don't scrape private/locked social media content. Don't build surveillance tools. |
| **IP infringement** | "Infringe, misappropriate, or violate the intellectual property rights of a third party" | Don't copy proprietary code/assets. Clean-room interop from public behavior is fine. |
| **Model distillation** | Using I/O to train another AI model without Anthropic authorization | Don't use Fable outputs as training data for local models without permission. |
| **Deceptive content** | Fake reviews, impersonation without disclosure, misleading information | AI-generated content for distribution needs attribution. |
| **Sexual content** | Explicit sexual content, erotic chat, fetish content | Not relevant to our streams but hard-blocked. |

## What does NOT block us

- **Reverse engineering our own code/data** — owner-authorized, explicitly fine.
- **Browser automation** of logged-in sessions — operating as a normal user (CuaDriver, CDP, Playwright) is fine; spoofing/bypassing is not.
- **Downloading books/resources** — fetching publicly accessible or personal-library content is fine; bypassing paywalls/DRM is not.
- **API reversal of services we use** — observing public behavior for interop is fine (clean-room); impersonating official clients or extracting private APIs is not.
- **Agentic use** — explicitly allowed, subject to the same usage policy. No extra restrictions beyond "still follow the rules."
- **Code generation** — no restrictions on what code Fable writes, as long as the *use* of that code doesn't violate the policy.
- **Research/analysis** — reading, summarizing, critiquing any public material is fine.

## Practical rules for this repo

1. **No jailbreak tooling.** Don't build, test, or store prompt-injection/jailbreak templates. `godmode.ts` is archived and must stay archived.
2. **No unauthorized security tools.** Vulnerability scanning, exploit development, or penetration testing only against systems Arthur owns or has written authorization for.
3. **No platform impersonation.** Browser automation is fine; forging API headers, extracting bearer tokens, or bypassing rate-limits is not. The line: "would a normal user do this in a browser?" If yes → fine. If no → don't.
4. **No private API scrapers.** Use official APIs or normal browser interaction. Reverse-engineering private endpoints to build automated scrapers crosses the line.
5. **Clean-room only for interop.** Observe public behavior, document it, implement from the doc. Don't decompile proprietary code or extract non-public protocols.
6. **Content attribution.** If Fable-generated content is published externally, disclose AI involvement.
7. **Archive, don't delete.** ToS-violating content moves to `.archive/` (gitignored) rather than being destroyed — Arthur may need it for non-Fable sessions.
