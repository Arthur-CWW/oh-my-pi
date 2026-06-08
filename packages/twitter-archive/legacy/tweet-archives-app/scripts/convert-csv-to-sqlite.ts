import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';

const csvData = readFileSync('gcr-tweets.csv', 'utf-8');
const lines = csvData.trim().split('\n');
const headers = lines[0]?.split(',').map(header => header.trim().replace(/^\uFEFF/, '')) || []; // Remove BOM if present

const db = new Database('tweets.db');

// Create tweets table
db.exec(`
  DROP TABLE IF EXISTS tweets;
  CREATE TABLE tweets (
    tweet_id TEXT PRIMARY KEY,
    text TEXT,
    language TEXT,
    type TEXT,
    bookmark_count INTEGER,
    favorite_count INTEGER,
    retweet_count INTEGER,
    reply_count INTEGER,
    view_count INTEGER,
    created_at TEXT,
    client TEXT,
    hashtags TEXT,
    urls TEXT,
    media_type TEXT,
    media_urls TEXT,
    archive_state TEXT NOT NULL DEFAULT 'pending',
    archive_updated_at TEXT,
    archive_snapshot_path TEXT,
    archive_source TEXT,
    archive_error TEXT
  )
`);

db.exec(`
  DROP TABLE IF EXISTS tweet_archives;
  CREATE TABLE tweet_archives (
    tweet_id TEXT PRIMARY KEY,
    author_name TEXT,
    author_handle TEXT,
    tweet_text TEXT,
    html TEXT,
    source TEXT,
    snapshot_timestamp TEXT,
    captured_at TEXT,
    fetched_at TEXT,
    raw_json_path TEXT,
    state TEXT NOT NULL DEFAULT 'pending'
  )
`);

const insert = db.prepare(`
  INSERT INTO tweets (
    tweet_id, text, language, type, bookmark_count, favorite_count, 
    retweet_count, reply_count, view_count, created_at, client, 
    hashtags, urls, media_type, media_urls
  ) VALUES ($tweet_id, $text, $language, $type, $bookmark_count, $favorite_count, 
    $retweet_count, $reply_count, $view_count, $created_at, $client, 
    $hashtags, $urls, $media_type, $media_urls)
`);

let inserted = 0;
for (let i = 1; i < lines.length; i++) {
  const line = lines[i] || '';
  const values = parseCSVLine(line);
  
  if (values.length === headers.length) {
    try {
      insert.run({
        $tweet_id: values[0] || '',
        $text: values[1] || '',
        $language: values[2] || '',
        $type: values[3] || '',
        $bookmark_count: parseInt(values[4] || '0') || 0,
        $favorite_count: parseInt(values[5] || '0') || 0,
        $retweet_count: parseInt(values[6] || '0') || 0,
        $reply_count: parseInt(values[7] || '0') || 0,
        $view_count: parseInt(values[8] || '0') || 0,
        $created_at: values[9] || '',
        $client: values[10] || '',
        $hashtags: values[11] || '',
        $urls: values[12] || '',
        $media_type: values[13] || '',
        $media_urls: values[14] || ''
      });
      inserted++;
    } catch (error) {
      console.error(`Error inserting row ${i}:`, error);
    }
  }
}

console.log(`Successfully inserted ${inserted} tweets into SQLite database`);

// Helper function to parse CSV lines with quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}
