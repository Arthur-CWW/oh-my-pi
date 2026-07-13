# Shared capability gateway

## Purpose

Primer, playground, companion, and the harness repeatedly need the same capabilities: streamed language-model responses, image generation, speech synthesis, public data sources, routing, usage accounting, and project-level work tracking. Reimplementing these per project creates drift.

The gateway should expose existing OMP capabilities as orthogonal, composable services. It must not create a second provider stack.

## Architecture

### Harness

Owns sessions, agents, journals, durable input, lifecycle, and views.

### Gateway daemon

A standalone local package importing the same provider registry, model routing, usage admission, and media clients already used by the harness. It has no dependency on a live session.

Initial endpoints:

- Streaming text completions through a broadly compatible HTTP surface.
- Image generation with existing named spending caps and dry-run defaults.
- Speech synthesis.
- Cached public-source search.
- Usage and outcome records attributed by project and workstream.

Projects identify themselves explicitly. Model roles such as `smol`, `default`, and `slow` remain user-level policy rather than project-local configuration.

## Cached data sources

Source adapters normalize external records into a shared envelope:

- source and author identity
- stable item id
- publication and synchronization timestamps
- text, links, and media references
- cache provenance and freshness

Adapters own fetching and cursors. The cache owns deduplication and search. Agents query the cache first and request synchronization only when freshness is insufficient.

Initial adapters: public feeds, Twitter/X-compatible public feeds, model-availability announcements, and followed-account collections.

## Multi-project requests

The current request register should become a control-plane table rather than remain only a document. Each request records:

- verbatim ask
- project/workstream
- originating session
- status and owner
- implementation and proof references

The workstream page then provides one cross-project queue. Documents remain generated review surfaces, not competing authorities.

## User-level preferences

Preferences that recur across projects should live once with provenance and scope:

- global user preference
- project preference
- session-only instruction
- observed but unconfirmed tendency

Agents receive the relevant projection. They do not copy preferences into project-specific prompts.

## Primitive boundaries

- Journal: session truth.
- Queue-v2: durable input authority.
- AgentRef: identity and lineage.
- DeliveryRecord: message provenance and delivery state.
- Provider registry: capability and routing authority.
- Source cache: external-data freshness and search authority.
- Request table: cross-project work authority.

Each primitive has one writer contract and several projections. New consumers extend projections rather than adding parallel stores.

## Delivery order

1. Inventory duplicated provider and source clients across projects.
2. Extract the gateway daemon around existing provider libraries.
3. Migrate one low-risk consumer, likely playground, without compatibility shims.
4. Add cached-source adapters and project attribution.
5. Move the request register into control-plane storage.
6. Add user-preference projection after its ontology is agreed.

## Non-goals

- Rebuilding a generic cloud proxy.
- Coupling provider access to a live OMP session.
- Automatically changing external accounts or social lists without explicit approval.
- Big-bang migration of every project.
