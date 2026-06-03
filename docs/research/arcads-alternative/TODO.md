# Arcads Alternative TODO

## Overnight / current

- [ ] Queue GPT Pro research prompts in ChatGPT project `arcads-ugc-lab`.
- [ ] Collect outputs into `gpt-pro-outputs/`.
- [ ] Synthesize outputs into a build plan after Arthur wakes up.

## Later: generalize tooling

- [ ] Generalize the Firefox/X article archive script into a reusable tool instead of a one-off Alex script.
  - Inputs: browser history/open tabs/search query/account handle/URL list.
  - Outputs: Markdown archive, source metadata, media links, summaries.
  - Respectful rate limits and auth boundaries.
- [ ] Build a general GPT Pro queue runner for Pi/frontend LLM sessions.
  - Queue file with prompt path, project, provider, spacing, output path.
  - Submit jobs with configurable delay.
  - Persist session IDs/conversation URLs.
  - Long-poll/collect outputs with retries.
  - Resume after interruption.
- [ ] Fix/rename the ChatGPT project title in the frontend if desired; current saved alias is `arcads-ugc-lab` and URL works.
