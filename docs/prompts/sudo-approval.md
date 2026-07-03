# Sudo Approval Protocol

When an agent needs to run commands requiring `sudo`, it MUST use the `ask` tool with enough context for Arthur to understand what's being approved.

## Format

```
ask(
  questions: [{
    id: "sudo_approval",
    question: "Run with sudo?",
    options: [{
      label: "Approve — <command summary>",
      description: "Full command: `<exact command>`\nWorking directory: `<cwd>`\n\nWhy needed: <1-2 sentences>\nImpact: <what changes, what risks>\nReversible: <yes/how / no>"
    }, {
      label: "Deny"
    }]
  }]
)
```

## Rules

- NEVER run sudo without explicit approval. This is inviolable.
- Every sudo ask MUST include: the exact command, working directory, why it's needed, what it changes, and whether it's reversible.
- Batch related sudo operations into a single approval when they share the same context.
- If the command is destructive (disk writes, system config changes, nvram writes), mark "Reversible: NO — <explain why>".
- Arthur authenticates via fingerprint — the approval is the gate, not the password prompt.

## Common sudo operations and their justification templates

### nvram boot-args
```
Why needed: AMFI must be disabled for vphone-cli to boot unsigned binaries.
Impact: Sets amfi_get_out_of_my_way=1 boot argument. Survives reboots.
Reversible: YES — sudo nvram -d boot-args
```

### make build (vphone-cli)
```
Why needed: vphone-cli binary requires codesigning with private entitlements.
Impact: Compiles and signs Swift binary. Build artifacts in .build/.
Reversible: YES — make clean
```

### make ramdisk_build
```
Why needed: Builds signed SSH ramdisk for CFW installation.
Impact: Creates ramdisk image with trustcache in scripts/ramdisk/.
Reversible: YES — rm -rf scripts/ramdisk/*
```

### csrutil / SIP changes
```
Why needed: [specific reason — vphone-cli requires debug entitlements].
Impact: [what SIP flag changes]. Survives reboots until re-enabled.
Reversible: YES — re-enable in Recovery with csrutil enable
```

## Never approve without context

If an agent asks for sudo without explaining WHY, deny and ask for the full context. The default answer to "can I run sudo?" without context is NO.
