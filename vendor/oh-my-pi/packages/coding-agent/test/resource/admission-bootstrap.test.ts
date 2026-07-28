import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { coordinatorRootIdentities } from "@oh-my-pi/pi-coding-agent/resource/admission-bootstrap";
import type { ProcessIdentity } from "@oh-my-pi/pi-coding-agent/resource/process-identity";

describe("coordinator process identity deduplication", () => {
	let root: string;
	let bus: IrcExternalBus;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-admission-identity-"));
		// Injected rather than redirected through HOME: `os.homedir()` under Bun
		// keeps returning the real home, so the process-wide bus would publish
		// these fixtures into the live fleet directory and then collide with
		// itself on the next run.
		bus = new IrcExternalBus(path.join(root, "irc-bus.sqlite"));
	});

	afterEach(async () => {
		bus.close();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("keeps colon-colliding full tuples distinct and collapses exact duplicates", () => {
		const left: ProcessIdentity = { bootId: "a", pid: 1, startFingerprint: "2:x" };
		const right: ProcessIdentity = { bootId: "a:1", pid: 2, startFingerprint: "x" };
		const db = new Database(bus.dbPath);
		try {
			const insert = db.query<void, { $sessionId: string; $pid: number; $lastSeen: string; $identity: string }>(
				`INSERT INTO peers (session_id, name, cwd, pid, last_seen, process_identity_json)
				 VALUES ($sessionId, $sessionId, $sessionId, $pid, $lastSeen, $identity)`,
			);
			for (const [sessionId, identity, lastSeen] of [
				["left", left, "2100-01-01T00:00:03.000Z"],
				["right", right, "2100-01-01T00:00:02.000Z"],
				["left-duplicate", left, "2100-01-01T00:00:01.000Z"],
			] as const) {
				insert.run({
					$sessionId: sessionId,
					$pid: identity.pid,
					$lastSeen: lastSeen,
					$identity: JSON.stringify(identity),
				});
			}
		} finally {
			db.close();
		}

		const adversarialRoots = coordinatorRootIdentities(bus).filter(
			identity => identity.bootId === left.bootId || identity.bootId === right.bootId,
		);
		expect(adversarialRoots).toEqual([left, right]);
	});
});
