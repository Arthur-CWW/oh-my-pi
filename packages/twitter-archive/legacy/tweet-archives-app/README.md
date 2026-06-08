# Tweet Archive Reader

A React-based tweet archive reader that mimics the original Twitter UI as closely as possible.

## Features

- **SQLite Database**: Converted CSV tweet data to SQLite for better querying
- **Twitter-like UI**: Mimics Twitter's design with engagement metrics, media display, and thread indicators
- **Archive Hydration**: Inline quote tweets via cached embeds pulled from the Wayback Machine or live Twitter oEmbed
- **TypeScript**: Full TypeScript support with proper type definitions

## Setup

1. **Install dependencies**:
   ```bash
   bun install
   ```

2. **Convert CSV to SQLite** (if not already done):
   ```bash
   bun run convert
   ```

3. **Start the development servers**:
   - API Server (port 3001): `bun run server`
   - React App (port 3000): `bun run dev`

## Project Structure

- `gcr-tweets.csv` - Original tweet archive data
- `tweets.db` - SQLite database (auto-generated)
- `src/` - React application
  - `App.tsx` - Main application component
  - `components/Tweet.tsx` - Individual tweet display
  - `types.ts` - TypeScript type definitions
- `server.ts` - API server for serving tweets
- `scripts/convert-csv-to-sqlite.ts` - CSV to SQLite conversion script

## Tech Stack

- **Runtime**: Bun
- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS (inline styles)
- **Database**: SQLite (Bun's built-in)
- **Development**: Hot reload with Vite

## Data Schema

The SQLite database contains a `tweets` table with the following columns:
- `tweet_id` - Unique tweet identifier
- `text` - Tweet content
- `language` - Language code
- `type` - Tweet type (Tweet, Reply, Retweet)
- Engagement metrics (bookmark_count, favorite_count, etc.)
- `created_at` - Timestamp
- `client` - Twitter client/source
- `hashtags`, `urls` - Additional tweet metadata
- `media_type`, `media_urls` - Media attachments
- `archive_state`, `archive_updated_at`, `archive_snapshot_path`, `archive_source`, `archive_error` - Hydration pipeline metadata

Hydrated embeds are stored in a companion `tweet_archives` table used when the
primary archive lacks text (e.g. protected or deleted tweets).

## Hydrating missing tweets

The repository ships with a small Python helper found in
`python/tweet_hydrator/`. It replicates the minimal functionality needed from
the upstream `waybacktweets` project while adding caching, resumable state, and
direct SQLite writes.

```bash
# install dependencies into a uv-managed virtualenv
uv venv
uv pip install -r python/tweet_hydrator/pyproject.toml

# hydrate the supplied tweet ids (can be repeated safely)
uv run tweet-hydrator run --tweet-id 1623000277472141312

# or hydrate every tweet whose archive_state is still pending
uv run python -m tweet_hydrator  # resumes pending/failed work or rehydrates whole archive

# ids can also be read from a file (one per line)
uv run python -m tweet_hydrator --ids-file quote_ids.txt

Flags worth remembering:

- `--from-state <state>` hydrates only rows whose `archive_state` matches (defaults to `pending`, `fetching`, and `failed`).
- `--limit N` processes only the first `N` tweets after filters (useful for spot checks).
- `--log-every 10` emits a log line every N tweets while keeping the progress bar concise.
- `--concurrency 8` adjusts batch size for faster hydration while staying polite to upstream services.
```

Raw embed payloads are cached beneath `data/wayback/raw/` while parsed text is
upserted into `tweet_archives`. The UI will automatically surface these records
for quote tweets once hydrated.

## Usage

1. Start both servers:
   ```bash
   # Terminal 1 - API Server
   bun run server

   # Terminal 2 - React App
   bun run dev
   ```

2. Open http://localhost:3000 in your browser

3. Browse through the tweet archive with Twitter-like UI elements
# tweet-hydrator

A small SQLite-aware pipeline that hydrates tweet metadata and embed HTML from
Twitter/Wayback and stores the results alongside the existing `tweets.db`
archive.

## Usage

```bash
# create a uv environment and install dependencies
uv venv
uv pip install -r python/tweet_hydrator/pyproject.toml

# hydrate specific tweet ids
uv run python/tweet_hydrator -d tweets.db run --tweet-id 1623000277472141312

# hydrate ids listed in a file (one per line)
uv run python/tweet_hydrator -d tweets.db run --ids-file ids.txt
```

The CLI stages work is resumable; rerunning the command will skip tweets whose
`tweet_archives.state` is already `applied` unless `--force` is provided.

Outputs are stored beneath `data/wayback/` and the resulting parsed content is
written to the `tweet_archives` table for consumption by the UI.
