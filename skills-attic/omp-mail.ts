#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface MailRow {
	id: number;
	ts: string;
	from_session: string;
	to_session: string;
	body: string;
	read: number;
}

const DB_PATH = path.join(os.homedir(), ".omp", "agent", "mailbox.sqlite");

function usage(exitCode = 1): never {
	const text = [
		"Usage:",
		"  omp-mail send <to> <body> [--from <name>]",
		"  omp-mail inbox <name> [--all]",
		"  omp-mail peek <name>",
	].join("\n");
	const stream = exitCode === 0 ? process.stdout : process.stderr;
	stream.write(`${text}\n`);
	process.exit(exitCode);
}

function takeFlag(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) usage();
	args.splice(index, 2);
	return value;
}

function hasFlag(args: string[], flag: string): boolean {
	const index = args.indexOf(flag);
	if (index === -1) return false;
	args.splice(index, 1);
	return true;
}


function openDb(): Database {
	fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
	const db = new Database(DB_PATH);
	db.run("PRAGMA journal_mode = WAL");
	db.run(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY,
			ts TEXT DEFAULT (datetime('now')),
			from_session TEXT,
			to_session TEXT,
			body TEXT,
			read INTEGER DEFAULT 0
		)
	`);
	return db;
}


function printRows(rows: MailRow[]): void {
	if (rows.length === 0) {
		process.stdout.write("(no messages)\n");
		return;
	}
	process.stdout.write(`${rows.map(row => `[${row.id}] ${row.ts} ${row.from_session} -> ${row.to_session}: ${row.body}`).join("\n")}\n`);
}

function send(args: string[]): void {
	const from = takeFlag(args, "--from") ?? process.env.OMP_MAIL_FROM?.trim() ?? process.env.OMP_SESSION?.trim() ?? process.env.USER?.trim() ?? "unknown";
	if (args.length < 2) usage();
	const [to, ...bodyParts] = args;
	const body = bodyParts.join(" ").trim();
	if (!to.trim() || !body) usage();
	const db = openDb();
	const result = db
		.query("INSERT INTO messages (from_session, to_session, body) VALUES ($from, $to, $body)")
		.run({ $from: from, $to: to, $body: body });
	process.stdout.write(`sent ${result.lastInsertRowid} ${from} -> ${to}\n`);
}

function list(args: string[], markRead: boolean): void {
	const all = hasFlag(args, "--all");
	if (args.length !== 1) usage();
	const [name] = args;
	if (!name.trim()) usage();
	const db = openDb();
	const sql = all
		? "SELECT id, ts, from_session, to_session, body, read FROM messages WHERE to_session = $name ORDER BY id"
		: "SELECT id, ts, from_session, to_session, body, read FROM messages WHERE to_session = $name AND read = 0 ORDER BY id";
	const rows = db.query<MailRow, { $name: string }>(sql).all({ $name: name });
	printRows(rows);
	if (markRead && rows.length > 0) {
		const ids = rows.map(row => row.id);
		const placeholders = ids.map(() => "?").join(",");
		db.query(`UPDATE messages SET read = 1 WHERE id IN (${placeholders})`).run(...ids);
	}
}

const argv = process.argv.slice(2);
const command = argv.shift();

if (command === "send") {
	send(argv);
} else if (command === "inbox") {
	list(argv, true);
} else if (command === "peek") {
	list(argv, false);
} else if (command === "help" || command === "--help" || command === "-h") {
	usage(0);
} else {
	usage();
}
