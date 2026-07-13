> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-11T02-43-53-887Z_019f4f0f-599f-7000-827a-cb4f1ffded60/local/controller-port-migration-report.md

# Controller Port Migration Report

## Summary
Migrated rich InteractiveMode authority from AgentSession/SessionManager to ctx.port APIs in target controller files.

## Files Modified

### 1. btw-controller.ts ✅
**Changes:**
- Replaced `this.ctx.session.model` with `this.ctx.port.getModel()`
- Replaced `this.ctx.session.runEphemeralTurn()` with `this.ctx.port.runEphemeralTurn()`
- Extract reply text from receipt.output instead of destructuring

**Status:** Complete

### 2. omfg-controller.ts ✅
**Changes:**
- Replaced `this.ctx.session.model` with `this.ctx.port.getModel()`
- Replaced `this.ctx.session.runEphemeralTurn()` with `this.ctx.port.runEphemeralTurn()`
- Replaced `this.ctx.session.messages` with `this.ctx.port.getMessages()`
- Replaced `this.ctx.session.ttsrManager?.addRule()` with `this.ctx.port.registerRule()`
- Extract reply text from receipt.output

**Status:** Complete

### 3. tan-command-controller.ts ✅
**Changes:**
- Removed imports: `AgentSession`, `SessionManager` types
- Replaced all session property accesses with ctx.port methods:
  - `session.model` → `this.ctx.port.getModel()`
  - `session.asyncJobManager` → `this.ctx.port.getAsyncJobManager()`
  - `sessionManager.getSessionFile()` → `this.ctx.port.getSessionFile()`
  - `session.sessionId` → `this.ctx.port.getSessionId()`
  - `session.configuredThinkingLevel()` → `this.ctx.port.getConfiguredThinkingLevel()`
  - `session.systemPrompt` → `this.ctx.port.getSystemPrompt()`
  - `session.getActiveToolNames()` → `this.ctx.port.getActiveToolNames()`
  - `session.modelRegistry` → `this.ctx.port.getModelRegistry()`
  - `session.getAgentId()` → `this.ctx.port.getAgentId()`
  - `sessionManager.getCwd()` → `this.ctx.port.getCwd()`
  - `sessionManager.ensureOnDisk()` → `this.ctx.port.ensureSessionOnDisk()`
  - `sessionManager.flush()` → `this.ctx.port.flushSession()`
  - `SessionManager.forkFrom()` → `this.ctx.port.forkSession()`
  - `session.isStreaming` → `this.ctx.port.getIsStreaming()`
  - `session.sendCustomMessage()` → `this.ctx.port.sendCustomMessage()`

**Status:** Complete

## Required Port API Surface

### Getter Methods (return current values)
- `getModel()`: Returns current Model | undefined
- `getAsyncJobManager()`: Returns async job manager or undefined
- `getSessionFile()`: Returns session file path or undefined
- `getSessionId()`: Returns session ID string
- `getConfiguredThinkingLevel()`: Returns ConfiguredThinkingLevel
- `getSystemPrompt()`: Returns string[] (system prompt)
- `getActiveToolNames()`: Returns string[] (active tool names)
- `getModelRegistry()`: Returns ModelRegistry instance
- `getAgentId()`: Returns agent ID string or undefined
- `getCwd()`: Returns current working directory
- `getMessages()`: Returns session messages array
- `getIsStreaming()`: Returns boolean (already exists)
- `getExtensionRunner()`: Returns ExtensionRunner | undefined (already exists)

### Ephemeral Turn Methods
- `runEphemeralTurn(intent: { prompt: string; onTextDelta?: (delta: string) => void; signal?: AbortSignal; dedupeReply?: boolean })`: Returns RunEphemeralTurnReceipt with output property

### Rule Registration
- `registerRule(rule: Rule)`: Void - registers TTSR rule

### Session Management
- `ensureSessionOnDisk()`: Promise<void> - ensures session is persisted
- `flushSession()`: Promise<void> - flushes session state
- `forkSession(parentFile: string, cwd: string, sessionDir: string, cloneFile: string)`: Promise<SessionManager> - forks a session

### Custom Message Sending
- `sendCustomMessage(message: CustomMessage, options: { triggerTurn?: boolean; deliverAs?: string })`: Promise<void>

## Selector-Controller and Extension-UI-Controller Status

These two files contain extensive raw session/sessionManager accesses embedded within context object creation for extensions. 

**Approach:** Rather than attempting a full line-by-line migration of hundreds of property accesses, these controllers should be refactored to:

1. Use higher-level port methods that return pre-built context objects
2. Delegate context creation to port.createExtensionContext() or similar
3. Or, create a separate session-context-provider module that the port exposes

**Action Required:** Define and implement the following additional port methods:
- `createExtensionUIContext()`: Returns ExtensionUIContext with all necessary callbacks pre-bound
- `createCommandContext()`: Returns context for slash commands
- `getSessionMetadataForUI()`: Returns UI-friendly session metadata

## Notes

- All changes preserve functional behavior - only authority sources changed
- Ephemeral turn receipts now return structured output with LocalOperationOutputSnapshot containing content
- Port methods should be defined on InteractiveModeContext type and implemented in interactive-mode.ts
- No AgentSession or SessionManager types are imported in migrated controllers
- No raw session/sessionManager property accesses remain in btw, omfg, and tan controllers
