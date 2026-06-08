import { Database } from 'bun:sqlite';

const db = new Database('tweets.db');

// Count total tweets
const countStmt = db.prepare('SELECT COUNT(*) as count FROM tweets');
const count = countStmt.get() as { count: number };

// Get sample tweets
const sampleStmt = db.prepare('SELECT * FROM tweets LIMIT 5');
const sample = sampleStmt.all();

console.log(`Total tweets in database: ${count.count}`);
console.log('Sample tweets:');
console.log(JSON.stringify(sample, null, 2));
