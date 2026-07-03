# Claude Code / OMP Cleanup for Fable

This doc records the obsolete default MCP and custom Claude Code clutter removed to prepare the workspace for Anthropic Fable, and how to restore each piece if it is needed again.

## What was changed

### 1. `.omp/mcp.json` — disabled active project MCP server

**Removed:** the active `vphone` MCP server entry.

- **Why:** vphone is cybersecurity/reveng/red-team tooling (virtual phone control / anti-detection lab adjacent). It is not advisor/orchestrator context for Fable and was adding project-level MCP surface that every OMP session would load.
- **How:** the file was replaced with a valid empty MCP config (`mcpServers: {}`) while preserving the OMP MCP schema reference.
- **What was left alone:** `.omp/mcp.archived-porkbun.json` was kept as-is. It is already archived and not loaded by OMP.

#### Restore

To re-enable the vphone MCP server, replace the contents of `.omp/mcp.json` with:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/vendor/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "vphone": {
      "type": "stdio",
      "command": "uv",
      "args": [
        "--directory",
        "/Users/arthur/agents/vendor/pluginslab/vphone-mcp",
        "run",
        "vphone-mcp"
      ],
      "env": {
        "VPHONE_SOCK": "/Users/arthur/agents/vphone-cli/vm/vphone.sock"
      }
    }
  }
}
```

### 2. `/Users/arthur/.claude/settings.json` — removed custom hooks and statusline

**Removed:**

- The entire `hooks` block that invoked `/Users/arthur/.orca/agent-hooks/claude-hook.sh` on every `UserPromptSubmit`, `Stop`, `StopFailure`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `PermissionRequest` event.
- The `statusLine` block that ran `~/.claude/statusline-command.sh` as a custom status-line command.

**Why:** these were old Orca-era automation hooks and a hand-rolled statusline that are unrelated to Fable advisor work. They add external shell indirection, possible noise, and a dependency on `/Users/arthur/.orca/agent-hooks/claude-hook.sh`. Removing them lets Claude Code fall back to its built-in statusline and keeps settings.json limited to ordinary editor/theme/env preferences.

**Kept:** all ordinary preferences: `env`, `includeCoAuthoredBy`, `permissions`, `skipDangerousModePermissionPrompt`, `learnMode`, `feedbackSurveyState`, `theme`, `editorMode`, `verbose`, `autoCompactEnabled`, `todoFeatureEnabled`, `enableWorkflows`.

**Note:** `/Users/arthur/.claude/statusline-command.sh` and `/Users/arthur/.orca/agent-hooks/claude-hook.sh` themselves were **not deleted**; only their references in `settings.json` were removed.

#### Restore

To restore the Orca hook, re-add the `hooks` block to `/Users/arthur/.claude/settings.json`:

```json
{
  ...
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "if [ -x '/Users/arthur/.orca/agent-hooks/claude-hook.sh' ]; then /bin/sh '/Users/arthur/.orca/agent-hooks/claude-hook.sh'; fi",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "if [ -x '/Users/arthur/.orca/agent-hooks/claude-hook.sh' ]; then /bin/sh '/Users/arthur/.orca/agent-hooks/claude-hook.sh'; fi",
            "timeout": 10
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "if [ -x '/Users/arthur/.orca/agent-hooks/claude-hook.sh' ]; then /bin/sh '/Users/arthur/.orca/agent-hooks/claude-hook.sh'; fi",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "if [ -x '/Users/arthur/.orca/agent-hooks/claude-hook.sh' ]; then /bin/sh '/Users/arthur/.orca/agent-hooks/claude-hook.sh'; fi",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "if [ -x '/Users/arthur/.orca/agent-hooks/claude-hook.sh' ]; then /bin/sh '/Users/arthur/.orca/agent-hooks/claude-hook.sh'; fi",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "if [ -x '/Users/arthur/.orca/agent-hooks/claude-hook.sh' ]; then /bin/sh '/Users/arthur/.orca/agent-hooks/claude-hook.sh'; fi",
            "timeout": 10
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "if [ -x '/Users/arthur/.orca/agent-hooks/claude-hook.sh' ]; then /bin/sh '/Users/arthur/.orca/agent-hooks/claude-hook.sh'; fi",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

To restore the custom statusline, re-add:

```json
{
  ...
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline-command.sh"
  }
}
```

### 3. `/Users/arthur/.claude/config.json` — removed stale project context

**Removed:** project-history entries for old `/home/node/paraform-smartleads` and `/home/node/verifiers` workspaces.

**Why:** these were stale Claude Code project contexts from old work and are not useful Fable advisor context.

**Kept:** Claude Code auth/account fields and all non-project settings. The file was edited programmatically without printing or changing credentials.

#### Restore

A timestamped backup was written next to the config file before editing. Restore from the newest `config.json.backup.fable-prep-*` file if those old project histories are needed again.

## Files touched

- `.omp/mcp.json` — replaced active `vphone` server with empty `mcpServers`.
- `/Users/arthur/.claude/settings.json` — removed `hooks` and `statusLine`.
- `/Users/arthur/.claude/config.json` — removed two stale project-history entries; auth fields preserved.
- `docs/fable/claude-omp-cleanup.md` — this document.

## Files explicitly not touched

- `.omp/mcp.archived-porkbun.json` — already archived; left untouched.
- Vendor directories — left untouched.
