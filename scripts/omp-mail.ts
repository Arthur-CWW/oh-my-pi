#!/usr/bin/env bun
process.stderr.write("This local mailbox command has been retired. Use: omp irc list | send <peer> <message> [--from <name>] | inbox <peer> [--peek]\n");
process.exit(1);
