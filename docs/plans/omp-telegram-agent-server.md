# OMP Telegram Agent Server

## Goal

Build an OMP-controlled agent server in Telegram: a private Telegram supergroup with forum topics as durable agent lanes, and OMP as the router/session owner.

This is not a Telegram-native multi-bot debate system. Telegram is the mobile/workspace UI. OMP owns routing, agent orchestration, session state, handoffs, and cross-agent coordination.

## Decision

Build the first local slice on **Telegram private supergroup + Forum Topics**, but treat **Discord private server** as the better long-term target if back-history import and visible multi-bot workflows become hard requirements.

Why Telegram for this slice:

- Telegram has a simpler Bot API and no app-intent/developer-portal friction for the first local bridge.
- Forum topics match the desired Discord-server mental model: each topic is a channel-like lane with its own message history and notification settings.
- Mobile UX is strong, lightweight, and already logged in locally.
- Hermes already proved the important routing shape: `chat_id + message_thread_id` maps cleanly to isolated sessions.

Why not Telegram DM Private Chat Topics for the first OMP server:

- The server mental model is a group/workspace, not a private command-center DM.
- Private-chat topics depend on BotFather Threaded Mode and client support.
- Telegram's bot developer terms attach a 15% Stars fee to purchases inside a bot while private-chat topics are enabled. This is irrelevant for a private OMP bot that sells nothing, but the supergroup path avoids the dependency entirely.

When Discord is better:

- You want the Slack-style "add the bot to this channel/thread and let it read enough existing context" workflow. Discord bots with the right permissions can fetch channel messages through REST; Telegram Bot API cannot fetch arbitrary prior group/topic history.
- You want native slash-command UX, roles, richer bot identity conventions, and an existing Discord habit.
- You want visible bot-authored messages to be part of controlled multi-agent workflows. Discord exposes bot-authored messages; Telegram generally should not be used as a bot-to-bot coordination bus.
- You accept more setup/API surface and Discord-specific permission/intents work.

For OMP v1, Telegram is the lower-friction local bridge. For the full \"private Discord server for my agents\" product, keep the routing core platform-neutral so Discord can become the primary adapter without replacing OMP session logic.

## Premium / paid requirements

No Telegram Premium is required for the planned setup:

- Creating a bot via BotFather: no Premium.
- Creating a private group/supergroup: no Premium.
- Enabling forum topics in a group: no Premium.
- Adding the bot to the group: no Premium.
- Sending text/files/images/voice through the bot: no Premium.

Premium-only conveniences that are not required:

- Telegram's built-in voice/video transcription.
- Some custom emoji/status/avatar polish.
- Business-account bot integrations.

Private bot DM topics do not require user Premium, but enabling them in BotFather is tied to Telegram Stars fee terms for purchases inside that bot. OMP should use a private supergroup with forum topics first.

## Important platform caveats

### Bot-to-bot discussion

Do not rely on Telegram bots reading each other's messages in a group. Bot-to-bot behavior is constrained and has changed in recent Bot API releases. OMP should coordinate agents internally, then render each agent's status/reply into Telegram.

Recommended v1 shape:

```text
Arthur -> Telegram topic -> @omp_bot -> OMP router -> OMP agent(s)
OMP agent(s) -> OMP router -> @omp_bot posts back to same topic
```

If separate visible agent identities are wanted later, add one-bot-per-profile as a presentation layer. Keep coordination inside OMP.

### Back-history and Slack-style rescue flows

Slack can grant apps scoped channel history. Discord bots can also fetch channel messages when they have the right channel permissions and message-content access. Telegram Bot API cannot fetch arbitrary prior group/topic history after the fact; it receives future delivered updates, and privacy mode can further limit what arrives.

For the desired "add bot, fix this issue" workflow on Telegram, OMP needs an explicit capture path:

- Forward relevant messages/files to the OMP topic.
- Reply to the message that contains the issue and mention `@omp_bot`.
- Use `/import` later to ingest a pasted/exported transcript or selected message links.
- If arbitrary history ingestion is a hard requirement, prefer Discord, Slack, or Matrix over Telegram for that lane.

### Privacy mode

Telegram group bots default to privacy mode. With privacy mode on, the bot sees commands, direct replies, mentions, and service messages, not all group chatter.

Recommended OMP defaults:

- Private supergroup only.
- Keep replies/mentions as the default trigger.
- Optionally disable BotFather privacy mode only for the private OMP group, then enforce OMP-side allowlists and topic policy.
- Never assume unmentioned group chatter is safe instruction text.

## Workspace design

Create a private Telegram supergroup, for example `OMP Agents`.

Enable Forum Topics and create lanes:

```text
inbox
coding
research
browser
ops
long-runs
review
```

Initial bot model:

```text
@omp_bot            single router identity
```

Future presentation model:

```text
@omp_research_bot   visible research persona
@omp_code_bot       visible coding persona
@omp_ops_bot        visible ops persona
```

Even in the future model, OMP should own the internal graph.

## Routing model

Stable session key:

```text
telegram:{bot_username}:{chat_id}:{message_thread_id}:{user_id?}
```

Topic routing table:

```yaml
telegram:
  allowed_users:
    - "<arthur-user-id>"
  allowed_chats:
    - "<private-supergroup-id>"
  topics:
    coding:
      thread_id: 12
      default_agent: gpt-implementer
    research:
      thread_id: 19
      default_agent: kimi-researcher
    ops:
      thread_id: 23
      default_agent: maintenance-kimi
```

Default behavior:

- DM/root chat: setup/status only.
- Forum topic message mentioning the bot: dispatch to topic default agent.
- Reply to bot in an active topic session: continue same session.
- `/new`: reset topic session.
- `/background <prompt>`: launch OMP background task, report result to same topic.
- `/agent <name>`: switch default agent for the current topic/session.
- `/status`: show active OMP session id, agent, cwd, and last activity.

## Telegram UX for many OMP sessions

Use one Telegram bot identity for v1, but make every rendered message carry an OMP session card:

```text
🟣 OMP · CodingAgent
Session: slotok-provider-pipeline · task #T-2026-06-10-071
Branch: main · cwd: ~/agents
Status: running tool: bun test test/telegram-agent-server.test.ts
↳ Trigger: reply to Arthur's message #1234 in topic #coding
```

Display rules:

- One Telegram forum topic is a lane: `#coding`, `#research`, `#ops`, `#browser`.
- One OMP run/session is a card inside that lane.
- Initial response posts a compact status card.
- Tool/progress updates edit that same status card instead of spamming the topic.
- Final response posts below the status card with artifacts/files attached.
- Background tasks get their own card and update in place until done.
- Use a stable short session slug, agent role, cwd/repo, and linked trigger message so the single bot still feels like multiple working agents.

If separate visible personalities matter later, add multiple bot identities as presentation only. The routing/session graph should still live inside OMP.

## Voice/STT capture path

Voice helps with capture, but it does not bypass platform history limits.

Hermes' voice model to copy:

- Telegram/Discord voice messages are downloaded, transcribed, and treated as the user message.
- STT provider priority can be local `faster-whisper` first, then Groq/OpenAI/Mistral/xAI cloud fallbacks.
- Telegram can receive/send voice bubbles in chats.
- Discord can also run in voice channels: join VC, listen per user, detect silence, transcribe, run the agent, speak back with TTS.

OMP should copy this as a separate adapter layer:

- `voice message -> cached audio -> transcript -> normal OMP message`
- attach transcript text to the same session card
- preserve the original audio file as an artifact
- never use voice/STT as a way to scrape old chat history

## Hermes bridge reuse strategy

Hermes bridge code is useful reference material, but it is not directly importable into this OMP/Pi extension:

- Hermes adapters are Python gateway classes built around `discord.py`, `python-telegram-bot`, Hermes `MessageEvent`, Hermes session storage, and Hermes tool/runtime contracts.
- This repo's Pi extension runtime is TypeScript. Direct import would mean embedding a Python gateway process, not importing a library.
- Hermes is MIT-licensed, so OMP can port/borrow behavior with attribution where code is copied substantially.

Use one of two strategies:

1. **Port behavior into TS adapters** for OMP-owned routing. This keeps OMP sessions/tools native and lets Telegram, Discord, Slack, and Matrix share one platform-neutral router.
2. **Run Hermes as a sidecar** and bridge OMP to it over a narrow local API. This is fastest if Hermes already has exactly the UX needed, but it makes OMP depend on Hermes config, Python deps, and Hermes session semantics.

Default for this project: port the small pieces we need, starting from Telegram Bot API basics. For Discord, borrow Hermes' proven policies: mention gating, auto-threading, history backfill, bot-message loop filters, safe allowed-mentions defaults, attachment caps, and slash-command registration limits.

## Discord later: known limitations

Discord is better than Telegram for back-history and the Slack-style "add bot, fix this issue" workflow, but it has real constraints:

- Requires **Message Content Intent**; without it, gateway events arrive with empty text.
- Requires **Read Message History** and channel/thread permissions for context backfill.
- Privileged intents become an approval/verification issue if the bot is in 100+ servers. Personal/private use is fine.
- Message content access and permission overwrites are per-channel footguns; one private channel can silently hide context.
- Bot messages are visible, so multi-bot setups must prevent loops by ignoring self and only allowing selected bot authors.
- Discord hard-limits normal messages to 2,000 characters; long agent output must chunk or attach files.
- Upload size depends on server tier; free servers are much smaller than Telegram for big artifacts.
- Slash/application commands have registration/rate-limit quirks and a 100 global-command cap.
- Mentions are dangerous by default; the gateway must disable `@everyone`/role pings unless explicitly allowed.
- Voice is possible, but it adds gateway/audio dependencies and should not be in v1.

Implication: Discord should be the v2 adapter if the rescue/backfill workflow becomes central. Telegram remains the lower-friction v1 mobile bridge.

## First implementation slice

The first checked-in slice is intentionally not the full long-running gateway. It is a safe Bot API bridge for OMP/Pi:

- `telegram_agent_server` Pi tool.
- `pi-telegram-agent-server` CLI.
- Actions: `getMe`, `getUpdates`, `sendMessage`.
- Env fallback: `OMP_TELEGRAM_BOT_TOKEN` then `TELEGRAM_BOT_TOKEN`; `OMP_TELEGRAM_CHAT_ID` then `TELEGRAM_CHAT_ID`; optional `OMP_TELEGRAM_THREAD_ID` / `TELEGRAM_THREAD_ID`.
- Redacted output; never print bot tokens.

This proves local OMP can talk to Telegram before adding polling, session storage, and agent dispatch.

## Setup checklist

1. Create a bot with BotFather, or reuse a dedicated existing test bot.
2. Store token outside the repo:

```bash
export OMP_TELEGRAM_BOT_TOKEN='...'
```

3. Create private supergroup `OMP Agents`.
4. Add `@omp_bot` to the group.
5. Enable Topics in the group settings.
6. Create initial topics.
7. Send a message in the target topic mentioning the bot.
8. Run `getUpdates` to discover `chat_id` and `message_thread_id`.
9. Store discovered target outside the repo:

```bash
export OMP_TELEGRAM_CHAT_ID='-100...'
export OMP_TELEGRAM_THREAD_ID='12'
```

10. Send a smoke message with `sendMessage`.

## Later OMP gateway phases

1. SQLite-backed session/topic map.
2. Polling loop or webhook receiver.
3. OMP agent dispatch from Telegram updates.
4. Progress-message edits for tool activity.
5. Artifact/file upload handling.
6. `/import` transcript capture for Slack-style issue rescue.
7. Optional multi-bot presentation identities.
8. Discord/Matrix adapter using the same OMP routing core.
