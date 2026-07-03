# OMP Discord Agent Server

## Decision

Use Discord as the serious OMP agent-server target when back-history/context rescue matters.

Telegram remains useful for quick mobile topic lanes, but Telegram Bot API cannot fetch arbitrary prior topic/chat history. Discord can fetch channel/thread history with the right permissions, so it matches the Slack-style workflow better:

```text
Arthur and others discuss an issue
Arthur sends !goal or @omp goal in that channel/thread
OMP fetches recent context
OMP starts/continues an agent run
OMP posts status/final output back into the same channel/thread
```

## Open-source Discord alternatives

You do not have to host Matrix yourself; you can use a hosted Matrix provider. If self-hosting, Matrix/Synapse is heavier than Discord.

Practical alternatives:

| Option | Free to download | Self-host | Bot/history fit | Notes |
|---|---:|---:|---|---|
| Discord | No, SaaS | No | Strong | Best low-friction private server and bot ecosystem. Not open source. |
| Matrix/Element | Yes | Optional | Strong | Federated, powerful history, more ops/E2EE complexity. Hosted Matrix avoids self-hosting. |
| Mattermost | Yes | Yes | Strong | Most Slack-shaped open-source option. Good if you want local/self-hosted control. |
| Zulip | Yes | Yes | Strong | Excellent topic threading; less Discord-like, great for organized async work. |
| Rocket.Chat | Yes | Yes | Medium | Slack-like, more product/ops overhead. |
| Revolt | Yes | Yes | Medium | Discord-like open-source project; ecosystem/API maturity lower than Discord. |
| Mumble | Yes | Yes | Weak for text agents | Voice-first, not right for OMP text/tool workflows. |

Recommendation: Discord first. If you later want self-hosted/open-source, evaluate Mattermost or Zulip before Matrix unless federation/E2EE is specifically valuable.

## Discord API limits and constraints

Normal private-server OMP usage is far below Discord limits.

Important limits:

- HTTP REST limits are per-route and surfaced through `X-RateLimit-*` headers. Do not hard-code route quotas; parse headers and 429 `retry_after`.
- Global bot REST limit is roughly 50 requests/second per bot.
- Too many invalid requests can trigger Cloudflare temporary bans: Discord documents 10,000 invalid HTTP requests per 10 minutes for 401/403/429 style failures.
- Gateway sessions have identify/session-start limits. Keep one long-running gateway connection; do not restart in a loop.
- Normal message content hard limit: 2,000 characters. Long OMP output must chunk or attach an artifact.
- Slash/application commands have registration/rate-limit quirks and a 100 global-command cap. Use prefix-style `!goal` or `@bot goal` text first; add real slash commands later.
- Message Content Intent is required for `!goal`, `@bot goal`, and normal text messages in guild channels.
- Read Message History permission is required for context backfill.
- Bots cannot DM arbitrary users. For smoke tests, use a private server channel. Bot DMs require a shared server and user DM settings that allow it.

## Required Discord bot setup

Create a Discord application/bot in the Developer Portal.

Required toggles:

- Bot enabled.
- Message Content Intent enabled.
- Server Members Intent optional if we use numeric user IDs; useful later for role auth.
- Public Bot can be off if using a manually generated invite URL.

Invite scopes:

```text
bot applications.commands
```

Minimum permissions:

```text
View Channels
Send Messages
Read Message History
Send Messages in Threads
Attach Files
Embed Links
Add Reactions
```

Hermes' recommended permission integer for text/thread/reactions is `274878286912`.

## Server/channel organization

Create one private server: `OMP Agents`.

Suggested categories and channels:

```text
Projects
  # agents
  # twitter-archive
  # jimeng
  # browser-automation
  # slotok-provider

Workflows
  # inbox
  # goals
  # research
  # code-review
  # ops

Runtime
  # long-runs
  # artifacts
  # alerts
```

Default behavior:

- `#goals`: top-level `!goal ...` / `@omp goal ...` requests.
- Project channels: contextual project conversations and backfill.
- Threads: one OMP run per issue/task when the bot auto-threads.
- `#long-runs`: background agent status/result delivery.
- `#artifacts`: large logs/files/screenshots if the original channel would get noisy.

## OMP UX model

Use one Discord bot identity first: `OMP`.

Every OMP run renders as a session card:

```text
🟣 OMP · gpt-implementer
Session: discord:agents:#twitter-archive:goal-20260619-001
Goal: Fix archive sync failure
Status: running · tool: bun test test/twitter-archive.test.ts
Context: 28 channel messages backfilled since last bot turn
Artifacts: pending
```

Display rules:

- First response creates a status card.
- Progress updates edit the same card.
- Final answer replies under the card.
- Large outputs become files/artifacts.
- Each OMP subagent appears as a label inside the card, not a separate Discord bot at first.
- Real multi-bot identities can be added later as presentation, but OMP keeps the internal task graph.

Current V1 fancy layer:

- Gateway `!goal` replies use a purple OMP embed card.
- Card fields: session id, trigger author/channel, bounded backfill status, dispatch status, bounded artifact status, recent context.
- Bot output keeps `allowed_mentions.parse = []` so cards cannot ping `@everyone` or roles.
- When the trigger is in a guild, the card includes an `Open trigger` link button. Link buttons are static URL components and do not require interaction handlers.
- Gateway backfill is capped to Discord's 100-message REST maximum (default 50), stops context after the previous OMP bot response when found, and omits bot-authored rows from the rendered context.

Not in V1 yet:

- Real Approve/Pause/Stop buttons.
- Select menus.
- Modals.
- Ephemeral replies.

Those require Discord `INTERACTION_CREATE` Gateway handling and a 3-second ACK path before they are safe to ship.

## Discord UI backlog

Discord can reproduce the OMP multiple-choice UI as native components:

- buttons for 2-5 choices
- select menus for longer option lists
- an `Other...` button that opens a modal text input
- ephemeral responses for private clarification
- embeds for structured question/status cards

Discord cannot render arbitrary HTML or iframes inside normal chat messages. For web output:

- render HTML/report pages to a PNG preview and attach the HTML artifact
- send a rich embed with title, summary, image preview, and dashboard link
- use Discord Activities only for a later hosted iframe-like app; that is not a simple bot-message feature

Backlog items:

- `!goal` / later real slash-command UI with buttons: Approve, Pause, Stop, Open artifact
- `ask` tool renderer: Discord buttons/select/modal matching OMP's multiple-choice UI
- HTML artifact renderer: local screenshot preview + attached `.html`
- progress card edit loop with per-agent rows

## Backfill behavior

Copy Hermes' policy:

- On `!goal`, `@bot goal`, or mention, fetch recent channel/thread messages.
- Stop at the bot's previous response when possible.
- Safety cap default: 50 messages.
- Include chronological context in the OMP prompt.
- Ignore bot-authored messages by default except explicitly allowed OMP bots.
- Disable `@everyone`/role pings in all bot output.

Code proof path for the 2026-06-24 V1 hardening: `packages/web-access/src/discord-agent-server-gateway.boundary.ts` clamps `OMP_DISCORD_BACKFILL_LIMIT` / `DISCORD_HISTORY_BACKFILL_LIMIT`, fetches `before` the trigger message, selects only human context after the previous OMP bot response, and renders bounded `Backfill` and `Artifacts` fields showing context count, fetched count, stop status, ignored bot rows, and current artifact state. Root validation command: `cd packages/web-access && bun run typecheck && bun test ./test/discord-agent-server.test.ts`.

## First implementation slice

Implement a REST bridge first:

- `discord_agent_server` Pi tool.
- `pi-discord-agent-server` CLI.
- Actions: `config`, `getMe`, `fetchMessages`, `sendMessage`.
- Env fallback: `OMP_DISCORD_BOT_TOKEN` then `DISCORD_BOT_TOKEN`; `OMP_DISCORD_CHANNEL_ID` then `DISCORD_CHANNEL_ID`; optional `OMP_DISCORD_THREAD_ID` / `DISCORD_THREAD_ID`.
- Redacted token output.

Then add the long-running Gateway:

- connect Gateway with Message Content Intent
- listen for mentions and `!goal` / `@bot goal` text prefix
- map channel/thread to OMP session
- fetch context with REST
- launch OMP agent/task
- edit status card while running
- post final result

## Live local setup status

Verified on 2026-06-19:

- Discord server exists: `arthur's serverOMP Agents`.
- Guild ID: `1517403056592125955`.
- Default channel: `#general`.
- Channel ID: `1517403057749491745`.
- Discord application/bot: `OMP Agent Bridge`.
- Application/bot ID: `1517409211569406044`.
- Local secret env file: `~/.pi/omp-discord.env` (`0600`, not committed).
- `pi-discord-agent-server get-me` reached the bot.
- `pi-discord-agent-server send` posted a smoke message to `#general`.
- `pi-discord-agent-server fetch-messages` read recent channel history.
- `pi-discord-agent-server-gateway` received human-authored `!goal` messages, fetched prior messages, and replied with OMP goal cards. Post-Effect-refactor proof: message `1517417289656307763` had one embed, one link-button component, title `🟣 OMP goal accepted`, fields `Session`, `Trigger`, `Backfill`, `Status`, `Recent context`, and button `Open trigger`.

Known cleanup:

- Rename the server from `arthur's serverOMP Agents` to `OMP Agents`.
- Replace the Gateway proof card with real OMP agent dispatch.
- Add a persistent supervisor/daemon instead of running the Gateway as a foreground CLI.

## Safe setup boundary

Developer Portal token creation is secret-sensitive. Do not print or screenshot the bot token. If an automation reaches the Reset Token/Copy Token step, copy it into a local secret file/env without echoing it.
