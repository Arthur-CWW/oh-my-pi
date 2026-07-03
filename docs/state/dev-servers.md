# Dev server names (Portless)

Arthur's local convention is: every background dev server gets a stable `http://<name>.localhost` URL, then Chrome/cmux panes open the name instead of remembering ports.

`.localhost` resolves to `127.0.0.1` in Chrome without `/etc/hosts`. This repo uses plain Caddy as the boring reverse proxy:

- `portless` on npm is active (`0.15.x`, Apache-2.0) and purpose-built, but it requires Node 24, wraps each app command, assigns ports itself, and auto-elevates for TLS/443. That is more moving parts than a repo-wide registry for already-running servers.
- `localias` is a maintained Go/Caddy wrapper, but it manages `/etc/hosts`, TLS certs, and privileged ports for each alias. Useful for `.test`; unnecessary for `.localhost`.
- Plain Caddy is already installed on this Mac, is maintained, and only needs a checked-in Caddyfile plus a one-time privileged start for port 80.

## Registry

Edit `.dev-domains.json`:

```json
{
  "name": "myapp",
  "port": 3000,
  "description": "What starts this server",
  "command": "bun run myapp:dev"
}
```

Names become `http://myapp.localhost`. Keep names lowercase DNS labels. Do not register sibling WIP apps unless their owner asks; copy the disabled `example` entry when adding yours.

Current entries:

- `robomp.localhost` -> `127.0.0.1:6543` (Docker compose exposes robomp dashboard as host `6543 -> 8080`).
- `jimeng.localhost` -> `127.0.0.1:4188` (root `bun run jimeng:dashboard`; the package default is 4177, but the checked-in root script overrides it).
- `pi-cockpit` is not registered because it is a CLI/SQLite cockpit, not an HTTP server.

Render and validate after edits:

```bash
bun run dev-proxy:render
bun run dev-proxy:validate
```

## Running the proxy

Default listener is port 80, so Arthur must do the one-time privileged start himself:

```bash
cd ~/agents
bun run dev-proxy:render
sudo caddy start --config infra/dev-proxy/Caddyfile --adapter caddyfile
```

After that, normal registry edits can be reloaded with:

```bash
bun run dev-proxy:reload
```

For foreground debugging without port 80, use an unprivileged listener:

```bash
bun scripts/dev-proxy.ts run --listen :18080
```

## cmux browser panes

Open by name:

```bash
cmux browser open http://robomp.localhost
cmux browser open http://jimeng.localhost
```
