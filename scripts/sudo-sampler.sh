#!/bin/bash
# Fast sudo-invocation sampler (HR-168 evidence). Catches short-lived sudo processes the
# 5m reaper misses: samples every 2s for 12h, logging command + full parent chain.
# Started via nohup; self-terminates. No sudo, read-only.
set -u
OUT="/Users/arthur/agents/local/night/sudo-sampler.log"
END=$(($(date +%s) + 12 * 3600))
echo "=== sampler start $(date -Iseconds) pid=$$ ===" >> "$OUT"
while [ "$(date +%s)" -lt "$END" ]; do
  hits=$(ps -axo pid=,ppid=,command= | grep -E '^\s*[0-9]+\s+[0-9]+\s+sudo(\s|$)' | grep -v grep)
  if [ -n "$hits" ]; then
    while IFS= read -r line; do
      pid=$(echo "$line" | awk '{print $1}')
      ppid=$(echo "$line" | awk '{print $2}')
      chain=""
      cur="$ppid"
      for _ in 1 2 3 4 5; do
        [ -z "$cur" ] || [ "$cur" = "0" ] || [ "$cur" = "1" ] && break
        info=$(ps -p "$cur" -o ppid=,command= 2>/dev/null) || break
        chain="$chain  <-  $cur:$(echo "$info" | sed 's/^ *[0-9]* *//' | cut -c1-140)"
        cur=$(echo "$info" | awk '{print $1}')
      done
      echo "$(date -Iseconds) CAUGHT $line$chain" >> "$OUT"
    done <<< "$hits"
    sleep 5
  fi
  sleep 2
done
echo "=== sampler end $(date -Iseconds) ===" >> "$OUT"
