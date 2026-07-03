# vphone-mcp

MCP server for programmatic control of [vphone-cli](https://github.com/Lakr233/vphone-cli) iOS VMs. Enables AI-driven E2E testing by exposing the VM's display, touch input, and navigation as MCP tools.

## How it works

```
Claude Code / Claude Desktop
    │ MCP (stdio)
    ▼
vphone-mcp (Python)
    │ Unix socket (JSON)
    ▼
vphone-cli (Swift, vm/vphone.sock)
    │ Virtualization.framework
    ▼
iOS 26 VM
```

Every action returns a compact grayscale screenshot (~20-30KB) inline in the response, so the LLM can see what happened without a separate call.

## Setup

Requires [uv](https://github.com/astral-sh/uv) and a running vphone-cli VM with the host control socket enabled (PR [#261](https://github.com/Lakr233/vphone-cli/pull/261)).

```bash
git clone https://github.com/pluginslab/vphone-mcp.git
cd vphone-mcp
uv sync
```

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "vphone": {
      "command": "uv",
      "args": ["--directory", "/path/to/vphone-mcp", "run", "vphone-mcp"],
      "env": {
        "VPHONE_SOCK": "/path/to/vphone-cli/vm/vphone.sock"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vphone": {
      "command": "uv",
      "args": ["--directory", "/path/to/vphone-mcp", "run", "vphone-mcp"],
      "env": {
        "VPHONE_SOCK": "/path/to/vphone-cli/vm/vphone.sock"
      }
    }
  }
}
```

## Tools

### Hardware Keys
| Tool | Description |
|------|-------------|
| `go_home` | Press home button |
| `press_power` | Lock/wake the screen |
| `volume_up` | Volume up |
| `volume_down` | Volume down |

### Screenshots
| Tool | Description |
|------|-------------|
| `screenshot` | Capture the VM display (returns embedded image) |

### Pre-mapped Navigation
| Tool | Description |
|------|-------------|
| `open_app(name)` | Open an app by name from the home screen |
| `tap_back` | Tap the iOS back button (top-left) |
| `scroll_down` | Scroll down on current screen |
| `scroll_up` | Scroll up on current screen |
| `open_notification_center` | Swipe down from top-left |
| `open_control_center` | Swipe down from top-right |
| `open_app_switcher` | Slow swipe up from bottom |
| `open_search` | Tap the home screen Search bar |
| `swipe_to_next_page` | Swipe to next home screen page |
| `swipe_to_previous_page` | Swipe to previous home screen page |

Supported app names for `open_app`: FaceTime, Calendar, Photos, Mail, Notes, Reminders, Clock, TV, Games, App Store, Maps, Health, Wallet, Settings, Phone, Safari, Messages, Music.

### Raw Interaction
| Tool | Description |
|------|-------------|
| `tap(x, y)` | Tap at pixel coordinates (1290x2796) |
| `swipe(x1, y1, x2, y2, duration_ms)` | Swipe between two points |

Use `screenshot()` first to identify coordinates for app-specific UI elements.

## Example session

```
User: Open Settings and navigate to General > About

Claude: [calls open_app("Settings")]
        → sees Settings list
        [calls tap(400, 1880)]
        → sees General page
        [calls tap(400, 1100)]
        → sees About page with iOS 26.1, Serial: vphone-1337
```

## Configuration

| Env var | Description |
|---------|-------------|
| `VPHONE_SOCK` | Path to `vphone.sock` (auto-discovered if not set) |

## License

MIT
