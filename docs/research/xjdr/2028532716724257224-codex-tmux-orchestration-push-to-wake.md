# Codex-fork orchestration: worktree git-state tools, tmux-native persistent agents, push-to-wake

- Author: xjdr (@_xjdr)
- Dates: 2026-03-02 / 03-03 / 03-06
- URLs:
  - https://x.com/_xjdr/status/2028532716724257224
  - https://x.com/_xjdr/status/2028840485658427877
  - https://x.com/_xjdr/status/2030005624264872333 (reply to @reach_vb)
- Retrieved: 2026-07-04 via nitter.tiekoetter.com + api.fxtwitter.com
- Tags: orchestrator, tmux, push-to-wake, worktrees, git-for-agents, codex-fork

---

Mar 2 (three screenshots of the tools):

> new codex tools to manage complex git state especially in worktrees for multiple concurrent agents in the same repo as well as making tmux native agents first class . really happy with the new tools

Mar 3:

> i updated codex's multi agent work streams to have more descriptive names and the agents push to wake (vs polling) . they also now live in a combination of tmux panes and windows for long running / persistent sessions.

Mar 6 (reply to @reach_vb on codex multi-agent):

> i added some code to make them persist in tmux as a first class citizen (for long running and resumable agents) and to have push to wake instead of polling . i'd love to delete my versions and have official codex support those. otherwise, the scheduling and actual model integration has been excellent.

Design signals for a control plane: named work streams, push-to-wake instead of polling, tmux panes/windows as the persistence/UI substrate for long-running resumable agents, dedicated tools for multi-agent git state in shared repos.
