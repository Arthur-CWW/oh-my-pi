# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This project aims to build a React-based tweet archive reader that mimics the original Twitter UI as closely as possible. The project will use:
- **Bun** as the runtime/package manager
- **React** with TypeScript
- **shadcn/ui** for UI components
- **Tailwind CSS** for styling
- **SQLite** for data storage (preferred over CSV)
- No authentication required (local-only usage)

## Current Data Structure

### CSV Archive Format
The `gcr-tweets.csv` file contains 2,662 tweets with the following columns:
- `tweet_id`: Unique tweet identifier
- `text`: Tweet content (with preserved line breaks)
- `language`: Language code (en, zh, pt, etc.)
- `type`: Tweet type (Tweet, Reply, Retweet)
- `bookmark_count`, `favorite_count`, `retweet_count`, `reply_count`, `view_count`: Engagement metrics
- `created_at`: Timestamp
- `client`: Twitter client/source
- `hashtags`: Hashtags used in tweet
- `urls`: URLs included in tweet
- `media_type`: Type of media attached (photo, etc.)
- `media_urls`: URLs to media content
<PLEASE convert to SQLite for better querying>

### Key Data Challenges
- **Protected Account**: The original Twitter account (@GCRClassic) is now protected
- **Tweet Resolution**: Need to handle tweet linking using tweet IDs
- **URL Resolution**: Contains shortened URLs that need proper resolution
- **Thread Structure**: Many tweets are part of conversations/replies

## WaybackTweets Integration

A cloned `waybacktweets` Python package is available in the project for retrieving archived tweets from the Wayback Machine. Key components:

### Core Functionality
- **WaybackTweets**: Retrieves CDX data from Internet Archive's Wayback Machine
- **TweetsParser**: Parses archived tweet data with various field options
- **TweetsExporter**: Exports data to CSV, JSON, and HTML formats

### Key Features
- Query by username and date ranges
- Collapse duplicate results
- Resumption keys for large datasets
- Multiple export formats

### Direct CLI Usage
The waybacktweets CLI i've downlaoded you can find more about the implementation in the `waybacktweets/` directory.

```bash
waybacktweets GCRClassic

# Example with date range and limits
waybacktweets --from 20200305 --to 20231231 --limit 300 --verbose GCRClassic

# Export to different formats (automatically creates files)
waybacktweets GCRClassic  # Creates CSV, JSON, and HTML exports
```

### Key CLI Options
- `--from DATE` / `--to DATE`: Filter by date range (YYYYmmdd format)
- `--limit INTEGER`: Limit number of results
- `--verbose`: Show detailed logs
- `--collapse [urlkey|digest|timestamp:xx]`: Remove duplicates
- `--resumption_key TEXT`: Continue from previous query

### Python module usage

## Development Architecture

### Planned Tech Stack
- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS + shadcn/ui components
- **Data Layer**: SQLite database (converted from CSV)
- **Build Tool**: Bun
- **Development**: Hot reload with Vite

### Key Implementation Requirements
1. **SQLite Conversion**: Convert existing CSV data to SQLite for better querying
2. **Tweet Resolution**: Use tweet IDs to construct links: `https://twitter.com/GCRClassic/status/{tweet_id}`
3. **UI Fidelity**: Mimic Twitter UI elements including:
   - Thread display
   - Media embedding
   - Engagement metrics
   - Timestamp formatting
   - Reply/retweet indicators
4. **URL Handling**: Resolve shortened URLs and handle media URLs
5. **Thread Reconstruction**: Link related tweets in conversations

### Data Processing Pipeline
1. Convert CSV → SQLite
2. Normalize and clean data
3. Resolve URLs and media
4. Reconstruct tweet threads
5. Build React UI components

## Development Commands

Once the project is initialized, expected commands:
- `bun dev` - Start development server
- `bun build` - Build for production
- `bun lint` - Run linting
- `bun typecheck` - Run TypeScript checks

## Important Notes

- The account is protected, so direct API access is not possible
- Wayback Machine integration can supplement missing tweet content
- Focus on local-first experience with no external dependencies
- Prioritize accurate Twitter UI replication for archive reading experience