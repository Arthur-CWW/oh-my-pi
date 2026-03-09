import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

export type CookieMap = Record<string, string>;

const GOOGLE_ORIGINS = [
	"https://gemini.google.com",
	"https://accounts.google.com",
	"https://www.google.com",
] as const;

const ALL_COOKIE_NAMES = new Set([
	"__Secure-1PSID",
	"__Secure-1PSIDTS",
	"__Secure-1PSIDCC",
	"__Secure-1PAPISID",
	"NID",
	"AEC",
	"SOCS",
	"__Secure-BUCKET",
	"__Secure-ENID",
	"SID",
	"HSID",
	"SSID",
	"APISID",
	"SAPISID",
	"__Secure-3PSID",
	"__Secure-3PSIDTS",
	"__Secure-3PAPISID",
	"SIDCC",
]);

const CHROME_COOKIES_PATH = join(
	homedir(),
	"Library/Application Support/Google/Chrome/Default/Cookies",
);

interface SqliteDatabase {
	readonly prepare: (sql: string) => {
		readonly all: (...params: ReadonlyArray<unknown>) => Array<Record<string, unknown>>;
	};
	readonly close: () => void;
}

let sqliteModule: typeof import("node:sqlite") | null = null;
let sqliteImportError: string | null = null;

function loadSqliteDatabase(): typeof import("node:sqlite") | null {
	if (sqliteModule) {
		return sqliteModule;
	}
	if (sqliteImportError !== null) {
		return null;
	}

	const require = createRequire(import.meta.url);
	const originalEmitWarning = process.emitWarning.bind(process);
	process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
		const message = typeof warning === "string" ? warning : warning?.message ?? "";
		if (message.includes("SQLite is an experimental feature")) {
			return;
		}
		return (originalEmitWarning as (...inner: unknown[]) => void)(warning, ...args);
	}) as typeof process.emitWarning;

	try {
		sqliteModule = require("node:sqlite") as typeof import("node:sqlite");
		sqliteImportError = null;
		return sqliteModule;
	} catch (error) {
		sqliteImportError = error instanceof Error ? error.message : String(error);
		return null;
	} finally {
		process.emitWarning = originalEmitWarning;
	}
}

function supportsReadBigInts(): boolean {
	const [majorString, minorString] = process.versions.node.split(".");
	const major = Number(majorString ?? "0");
	const minor = Number(minorString ?? "0");
	if (major > 24) {
		return true;
	}
	if (major < 24) {
		return false;
	}
	return minor >= 4;
}

function openSqliteReadOnly(dbPath: string): SqliteDatabase | null {
	const sqlite = loadSqliteDatabase();
	if (!sqlite) {
		return null;
	}
	const options: Record<string, unknown> = { readOnly: true };
	if (supportsReadBigInts()) {
		options.readBigInts = true;
	}
	const db = new sqlite.DatabaseSync(dbPath, options);
	return db;
}

export async function readLegacyGoogleCookies(): Promise<{
	cookies: CookieMap;
	warnings: string[];
} | null> {
	if (platform() !== "darwin") {
		return null;
	}
	if (!existsSync(CHROME_COOKIES_PATH)) {
		return null;
	}

	const warnings: string[] = [];
	const password = await readKeychainPassword();
	if (!password) {
		warnings.push("Could not read Chrome Safe Storage password from Keychain");
		return { cookies: {}, warnings };
	}

	const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
	const tempDir = mkdtempSync(join(tmpdir(), "pi-chrome-cookies-"));

	try {
		const tempDb = join(tempDir, "Cookies");
		copyFileSync(CHROME_COOKIES_PATH, tempDb);
		copySidecar(CHROME_COOKIES_PATH, tempDb, "-wal");
		copySidecar(CHROME_COOKIES_PATH, tempDb, "-shm");

		const metaVersion = await readMetaVersion(tempDb);
		const stripHash = metaVersion >= 24;

		const hosts = GOOGLE_ORIGINS.map((origin) => new URL(origin).hostname);
		const rows = await queryCookieRows(tempDb, hosts);
		if (!rows) {
			warnings.push("Failed to query Chrome cookie database");
			if (sqliteImportError) {
				warnings.push(`node:sqlite import failed: ${sqliteImportError}`);
			}
			return { cookies: {}, warnings };
		}

		const cookies: CookieMap = {};
		for (const row of rows) {
			const name = row.name;
			if (typeof name !== "string") {
				continue;
			}
			if (!ALL_COOKIE_NAMES.has(name)) {
				continue;
			}
			if (cookies[name]) {
				continue;
			}

			let value = typeof row.value === "string" && row.value.length > 0 ? row.value : null;
			if (!value) {
				const encrypted = row.encrypted_value;
				if (encrypted instanceof Uint8Array) {
					value = decryptCookieValue(encrypted, key, stripHash);
				}
			}
			if (value) {
				cookies[name] = value;
			}
		}

		return { cookies, warnings };
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function decryptCookieValue(encrypted: Uint8Array, key: Buffer, stripHash: boolean): string | null {
	const buffer = Buffer.from(encrypted);
	if (buffer.length < 3) {
		return null;
	}

	const prefix = buffer.subarray(0, 3).toString("utf8");
	if (!/^v\d\d$/.test(prefix)) {
		return null;
	}

	const ciphertext = buffer.subarray(3);
	if (!ciphertext.length) {
		return "";
	}

	try {
		const iv = Buffer.alloc(16, 0x20);
		const decipher = createDecipheriv("aes-128-cbc", key, iv);
		decipher.setAutoPadding(false);
		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		const unpadded = removePkcs7Padding(plaintext);
		const bytes = stripHash && unpadded.length >= 32 ? unpadded.subarray(32) : unpadded;
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		let index = 0;
		while (index < decoded.length && decoded.charCodeAt(index) < 0x20) {
			index += 1;
		}
		return decoded.slice(index);
	} catch {
		return null;
	}
}

function removePkcs7Padding(buffer: Buffer): Buffer {
	if (!buffer.length) {
		return buffer;
	}
	const padding = buffer[buffer.length - 1];
	if (!padding || padding > 16) {
		return buffer;
	}
	return buffer.subarray(0, buffer.length - padding);
}

function readKeychainPassword(): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(
			"security",
			["find-generic-password", "-w", "-a", "Chrome", "-s", "Chrome Safe Storage"],
			{ timeout: 5000 },
			(error, stdout) => {
				if (error) {
					resolve(null);
					return;
				}
				resolve(stdout.trim() || null);
			},
		);
	});
}

async function readMetaVersion(dbPath: string): Promise<number> {
	const sqliteDb = openSqliteReadOnly(dbPath);
	if (sqliteDb) {
		try {
			const rows = sqliteDb.prepare("SELECT value FROM meta WHERE key = 'version'").all();
			const value = rows[0]?.value;
			if (typeof value === "number") {
				return Math.floor(value);
			}
			if (typeof value === "bigint") {
				return Number(value);
			}
			if (typeof value === "string") {
				return parseInt(value, 10) || 0;
			}
			return 0;
		} catch {
			return 0;
		} finally {
			sqliteDb.close();
		}
	}

	const raw = await runSqliteCli(dbPath, "SELECT value FROM meta WHERE key = 'version';");
	if (!raw) {
		return 0;
	}
	const first = raw.split("\n")[0]?.trim();
	if (!first) {
		return 0;
	}
	return parseInt(first, 10) || 0;
}

async function queryCookieRows(
	dbPath: string,
	hosts: ReadonlyArray<string>,
): Promise<Array<Record<string, unknown>> | null> {
	const clauses: string[] = [];
	for (const host of hosts) {
		for (const candidate of expandHosts(host)) {
			const escaped = candidate.replaceAll("'", "''");
			clauses.push(`host_key = '${escaped}'`);
			clauses.push(`host_key = '.${escaped}'`);
			clauses.push(`host_key LIKE '%.${escaped}'`);
		}
	}
	const where = clauses.join(" OR ");

	const sqliteDb = openSqliteReadOnly(dbPath);
	if (sqliteDb) {
		try {
			return sqliteDb
				.prepare(
					`SELECT name, value, host_key, encrypted_value FROM cookies WHERE (${where}) ORDER BY expires_utc DESC`,
				)
				.all();
		} catch {
			return null;
		} finally {
			sqliteDb.close();
		}
	}

	const raw = await runSqliteCli(
		dbPath,
		`SELECT name, value, host_key, hex(encrypted_value) FROM cookies WHERE (${where}) ORDER BY expires_utc DESC;`,
	);
	if (raw == null) {
		return null;
	}

	const rows: Array<Record<string, unknown>> = [];
	for (const line of raw.split("\n")) {
		if (!line) {
			continue;
		}
		const [name = "", value = "", hostKey = "", encryptedHex = ""] = line.split("\t");
		const row: Record<string, unknown> = { name, value, host_key: hostKey };
		if (encryptedHex) {
			try {
				row.encrypted_value = Buffer.from(encryptedHex, "hex");
			} catch {
				row.encrypted_value = new Uint8Array();
			}
		} else {
			row.encrypted_value = new Uint8Array();
		}
		rows.push(row);
	}
	return rows;
}

async function runSqliteCli(dbPath: string, sql: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(
			"sqlite3",
			["-readonly", "-noheader", "-separator", "\t", dbPath, sql],
			{ timeout: 5000 },
			(error, stdout) => {
				if (error) {
					resolve(null);
					return;
				}
				resolve(stdout.trim());
			},
		);
	});
}

function expandHosts(host: string): ReadonlyArray<string> {
	const parts = host.split(".").filter(Boolean);
	if (parts.length <= 1) {
		return [host];
	}
	const candidates = new Set<string>();
	candidates.add(host);
	for (let index = 1; index <= parts.length - 2; index++) {
		const candidate = parts.slice(index).join(".");
		if (candidate) {
			candidates.add(candidate);
		}
	}
	return [...candidates];
}

function copySidecar(srcDb: string, targetDb: string, suffix: string): void {
	const sidecar = `${srcDb}${suffix}`;
	if (!existsSync(sidecar)) {
		return;
	}
	try {
		copyFileSync(sidecar, `${targetDb}${suffix}`);
	} catch {
		// Ignore best-effort sidecar copy failures.
	}
}
