---
name: llm-frontend-browser
description: Use ChatGPT Pro, AI Studio, or other frontend LLM sites through the llm_frontend_browser tool. Load when considering expensive frontend LLM/deep-research calls, async ChatGPT Pro handoffs, or recovering/polling browser-based LLM responses.
---

# LLM Frontend Browser

Use `llm_frontend_browser` sparingly. It drives a real logged-in browser profile, can consume paid/pro quotas, and may take many minutes for ChatGPT Pro/deep-research style answers.

## When to use

Good fits:
- Initial product/architecture planning where a high-effort external model answer is worth the wait.
- Deep research or synthesis that needs ChatGPT Pro/frontend-only capabilities.
- Cross-checking major design decisions before implementation.

Avoid for:
- Routine coding questions you can answer locally.
- Fast documentation lookup; use normal web search/fetch first.
- Large parallel batches unless the user explicitly approves the quota/time cost.

## Recommended async workflow for long research

For anything likely to run longer than ~2 minutes, do not block the agent on the initial call.

1. Submit asynchronously:

```ts
llm_frontend_browser({
  action: "prompt",
  provider: "chatgpt",
  prompt: "...expensive research question...",
  waitForResponse: false
})
```

2. Save the returned `Session:` and `Conversation:` URL in your notes/response.

3. Later, recover or wait for completion:

```ts
llm_frontend_browser({
  action: "wait",
  provider: "chatgpt",
  session: "latest",           // or a saved session id prefix
  responseTimeoutMs: 900000,    // 15 minutes
  outputFile: "research.md"     // optional but useful for long answers
})
```

4. If the browser/CDP connection broke or the tool timed out, ChatGPT may still finish server-side. Reattach with:

```ts
llm_frontend_browser({ action: "collect", provider: "chatgpt", session: "latest" })
```

or use the explicit conversation URL:

```ts
llm_frontend_browser({ action: "collect", provider: "chatgpt", conversationUrl: "https://chatgpt.com/c/..." })
```

## Blocking workflow

Use blocking only for short prompts or when the user explicitly wants to wait:

```ts
llm_frontend_browser({
  action: "prompt",
  provider: "chatgpt",
  prompt: "Return exactly: ok",
  waitForResponse: true,
  responseTimeoutMs: 120000
})
```

## Parallelism guidance

- Default to one expensive ChatGPT Pro job at a time.
- Ask before launching multiple long-running jobs.
- For multiple independent questions, submit one async job, then decide if the result warrants more.
- Prefer `outputFile` for long answers so future turns can read the file instead of re-querying.

## Human/operational caveats

- The tool cannot solve CAPTCHA, passkeys, 2FA, account challenges, or accept terms. If `needsHuman: true`, stop and ask the user.
- Browser UI changes can break scraping. Use `collect` with the saved conversation URL after manual browser inspection.
- Treat outputs as external model advice: verify code/security/deployment steps locally before acting.
