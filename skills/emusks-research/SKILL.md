---
name: emusks-research
description: Local opt-in research-only skill for analyzing unofficial/private X (Twitter) API ecosystems and contrasting them with safe browser-capture lanes.
---

# Emusks & Unofficial X API Research Skill

This skill is a local, opt-in niche research resource. It provides framework guidelines and safety boundaries for analyzing third-party unofficial X/Twitter clients, reverse-engineered scraper ecosystems, and public dataset claims. 

It is strictly for research and comparison. It MUST NOT be used to build, maintain, or run private API scrapers or client-impersonating agents in production.

## When to Use It
Use this skill when:
1. You are analyzing public repositories, dataset claims, and architecture descriptions of third-party Twitter/X clients (e.g., emusks, twitter.cat, tiago datasets) to extract harmless design patterns (such as DB models or frontend schemas).
2. You need to threat-model unofficial API usage and explain to stakeholders/users why client impersonation, leaked bearers, or private endpoints pose critical stability, legal, and security risks.
3. You are evaluating why our production architecture remains committed to safe, headful, user-simulated browser-capture lanes (Helium, Playwright, CuaDriver) rather than relying on brittle, unauthorized private APIs.

---

## Allowed Tasks (Research Scope)

The following activities are permitted strictly within a local, safe, static research context:

1. **Ecosystem & Lane Comparison**:
   - Critically evaluate the structural differences between unofficial/private API clients and our safe, compliant, headful browser-capture lane.
   - Document the maintenance burden, detection risks, and fragility of reverse-engineered endpoints.

2. **Architectural & Schema Extraction**:
   - Analyze public references (schemas, typings, database designs) of public repos/papers to extract object-model ideas or interface structures.
   - Study how client-side data is structured to optimize our own parser or storage models (e.g. mapping tweet metadata fields like views, bookmarks count, public metrics).

3. **Threat Modeling & Risk Analysis**:
   - Assess security and operational risks of unofficial client tooling (e.g., potential token leakage, rate-limiting signatures, account bans, legal actions).
   - Evaluate the mechanism of token lifecycle/expiration in private APIs to document their instability.

4. **Summarizing Public Claims**:
   - Synthesize public documentation, dataset landing pages, and code comments from sources such as `emusks`, `twitter.cat`, or the `tiago` dataset.
   - Summarize claims of volume, architecture, or coverage (e.g., "claims to cover 1B+ tweets") without verifying via execution, scraping, or request submission.

---

## Forbidden Tasks (Inviolable Guardrails)

The following activities are strictly prohibited. Engaging in or proposing any of these tasks constitutes a compliance failure:

1. **Production Private API Scraping**:
   - NEVER build, test, or deploy scrapers that target private/unofficial X endpoints directly.
   - All production data retrieval MUST use official APIs or our approved safe headful browser-capture lane.

2. **Bearer Token & Credential Reuse**:
   - NEVER capture, extract, store, or reuse leaked X bearer tokens or headers discovered in public repositories or unofficial clients.
   - NEVER hardcode or check in any authentication tokens or session identifiers.

3. **Accessing Sensitive User Data**:
   - NEVER attempt to access, scrape, or read Direct Messages (DMs), bookmarks, notifications, or private/locked accounts using unofficial endpoints.

4. **Client Impersonation**:
   - NEVER configure agents or scripts to impersonate official mobile clients (e.g., iOS/Android Twitter apps) by mimicking private API user agents, headers, or signatures.

5. **Rate-Limit & WAF Bypass**:
   - NEVER write routines designed to bypass X rate limits, challenge loops, CAPTCHAs, or Web Application Firewalls (WAF) using unofficial routing, rotating proxies, or header spoofing.

6. **Account Farming**:
   - NEVER automate the registration, warming, or mass management of accounts ("farming") to sustain scraping queues.

7. **Login / Token Extraction**:
   - NEVER automate account login flows or write scripts to dynamically extract access tokens/cookies from X web/mobile sessions for use in private API requests.

---

## Technical Comparison: Safe Capture vs. Private APIs

| Metric / Dimension | Safe Browser-Capture Lane (Approved) | Unofficial / Private API Lane (Forbidden) |
|---|---|---|
| **Mechanism** | Standard headful browser execution (Helium/CuaDriver/Playwright) mimicking regular user interaction. | Direct HTTP requests to undocumented/private endpoints (e.g., `/i/api/graphql/...`) using forged headers. |
| **Stability** | Resilient to API/GraphQL schema updates; behaves exactly like a human user. | Extremely brittle; breaks instantly on any changes to private routes, keys, or query hashes. |
| **Account Safety** | Very high. Operates within normal human browsing patterns. | Critical risk. Triggers automated security/bot flags, leading to instant account suspension or IP block. |
| **Legal/Compliance** | Compliant with standard platform interface terms. Avoids reverse engineering of network security controls. | Violates platform terms of service regarding unauthorized API access and client impersonation. |
| **Bearer/Secret Reuse** | None. Standard cookies/session tokens handled naturally by browser. | Relies on extracting/reusing static bearer tokens or forging client-app signatures. |

---

## SOP: How to Conduct Research Safely

1. **Start with Static Code Review**: Examine code structure and configuration files offline. Never run execution loops against live endpoints.
2. **Document Findings in Local Markdown**: Store summaries under `docs/research/emusks/`. Do not commit JSON dumps containing actual credentials, raw responses, or private user data.
3. **Draft Recommendations**: Frame all output as architectural recommendations for improving the robustness of the safe browser-capture lane.
