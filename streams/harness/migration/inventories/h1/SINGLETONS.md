# Singletons inventory (H1 scoped task files)

All callsites of `.global()`, `getInstance()`, module-level mutable singletons, and process-global registry mutations found in the scout file scope.

## AgentRegistry.global()

- `executor.ts:280` — `AgentRegistry.global().list()` used to render IRC peer roster. Replace with a Context service provided by a Layer that carries the registry of live agents.
- `executor.ts:869` — `AgentRegistry.global().setStatus(...)` inside `createReAdoptedSessionReviver` subscription. Replace with a registry Context service that the reviver Layer provides.
- `executor.ts:870` — `AgentRegistry.global().setStatus(...)` inside the same subscription. Replace with the same registry Context service.
- `executor.ts:975` — `AgentRegistry.global().setStatus(...)` inside `createParkedChildSessionReviver` subscription. Replace with a registry Context service scoped to the child lifecycle.
- `executor.ts:978` — `AgentRegistry.global().setStatus(...)` inside the same subscription. Replace with the same registry Context service.
- `executor.ts:1208` — `AgentRegistry.global().setActivity(...)` in progress emission. Replace with a registry Context service consumed by the monitor Fiber.
- `executor.ts:1898` — `AgentRegistry.global().get(id)` when runtime limit exceeded. Replace with a registry Context service.
- `executor.ts:2214` — `AgentRegistry.global().setStatus(...)` in `runSubprocess` status sync. Replace with a registry Context service.
- `executor.ts:2217` — `AgentRegistry.global().setStatus(...)` in the same status sync. Replace with the same registry Context service.
- `executor.ts:2704` — `AgentRegistry.global()` used to set status on abort. Replace with a registry Context service.
- `index.ts:171` — `AgentRegistry.global()` used to derive spawn group by walking parent chain. Replace with a registry Context service.
- `index.ts:843` — `AgentRegistry.global()` used to list identity candidates. Replace with a registry Context service.
- `index.ts:1001` — `AgentRegistry.global().get(candidate)` used in `AgentOutputManager.allocate` callback. Replace with a registry Context service.
- `index.ts:1186` — `AgentRegistry.global().get(agentId)` used in async job follow-up hint. Replace with a registry Context service.
- `index.ts:1243` — `AgentRegistry.global().get(agentId)` used in `recordFinalizedSubagentFailure`. Replace with a registry Context service.
- `index.ts:1270` — `AgentRegistry.global().get(agentId)` used in thrown failure recording. Replace with a registry Context service.
- `index.ts:1648` — `AgentRegistry.global().get(candidate)` used in `#runSpawn` output allocation. Replace with a registry Context service.
- `spawn-worker-client.ts:161` — `AgentRegistry.global().list()` used to snapshot registry for worker. Replace with a registry Context service serialized into the worker request.
- `spawn-worker-client.ts:174` — `AgentRegistry.global()` used to project child refs from worker. Replace with a registry Context service.
- `spawn-worker-entry.ts:158` — `AgentRegistry.global()` used to initialize worker registry and subscribe to changes. Replace with a registry Context service provided by a Layer in the worker process.
- `re-adopt.ts:175` — `AgentRegistry.global()` used to adopt/re-adopt direct children. Replace with a registry Context service.

## AgentLifecycleManager.global()

- `executor.ts:2739` — `AgentLifecycleManager.global()` used to adopt/park idle children. Replace with a child-lifecycle Context service provided by a Layer.
- `index.ts:852` — `AgentLifecycleManager.global().canResumeInPlace(ref.id)` used in spawn identity candidates. Replace with a child-lifecycle Context service.
- `index.ts:1190` — `AgentLifecycleManager.global().canResumeInPlace(agentId)` used in async job follow-up hint. Replace with a child-lifecycle Context service.
- `re-adopt.ts:176` — `AgentLifecycleManager.global()` used to release adopted children on rollback. Replace with the same child-lifecycle Context service.

## IrcBus.global()

- `executor.ts:206` — `IrcBus.global().send(...)` used to notify parent of budget. Replace with an IRC bus Context service provided by a Layer; in Effect terms this is a PubSub or Mailbox service.

## MCPManager.instance()

- `index.ts:1681` — `MCPManager.instance()` used as fallback for parent MCP manager. Replace with an MCP manager Context service provided by a Layer.

## Module-level mutable singletons

- `index.ts:102` — `spawnGuideCache` module-level `Map<string, SpawnGuideCacheEntry>`. Replace with a Context-provided cache service (e.g., a Layer that caches spawn guide content by path and mtime).
- `index.ts:103` — `defaultSpawnGuidePathCache` module-level `Map<string, Promise<string>>`. Replace with a Context-provided path-resolution cache service.
- `index.ts:657` — `discoveryMemo` module-level `Map<string, Promise<DiscoveryResult>>`. Replace with a Context-provided agent-discovery cache service.
- `index.ts:658` — `discoveryMemoFn` module-level mutable `let`. Replace with a Context-provided discovery service; the function-swap invalidation pattern should be encoded in the service lifecycle.
- `spawn-worker-client.ts:27` — `spawnLaunchTail` module-level mutable promise chain. Replace with a `Semaphore(1)` Context service that serializes subprocess launches.
- `spawn-worker-client.ts:202` — `rssWatches` module-level `Map<number, RssWatch>`. Replace with a Context-provided RSS watch service backed by a `Ref` and a `Clock`-driven polling Fiber.
- `spawn-worker-client.ts:203` — `rssTimer` module-level mutable `Timer`. Replace with a `Clock`/`Schedule` Layer that owns the polling interval.
- `spawn-worker-client.ts:204` — `rssSampling` module-level mutable boolean. Replace with a `Ref` owned by the RSS watch Context service.
- `subagent-worker-entry.ts:11` — `parent = process` module-level capture of IPC process. Replace with a Context service that provides the parent IPC channel.
- `subagent-worker-entry.ts:12` — `active` module-level mutable object. Replace with a `Ref` provided by the worker Context service.
- `subagent-worker-entry.ts:19` — `turnsCompleted` module-level mutable counter. Replace with a `Ref` provided by the worker Context service.
- `subprocess-tool-registry.ts:52` — `SubprocessToolRegistryImpl.#handlers` private `Map`. Replace with a Context service provided by a Layer that maps tool names to handlers.
- `subprocess-tool-registry.ts:85` — `subprocessToolRegistry` module-level singleton export. Replace with a Context service provided by a Layer; tool handlers register through the Layer, not a module-level variable.

## Process-global registry mutations

- `spawn-worker-entry.ts:143` — `process.env.OMP_SUBPROCESS_WORKER = "1"`. Replace with a Layer configuration that explicitly selects subprocess worker mode; do not rely on process-global mutation.
