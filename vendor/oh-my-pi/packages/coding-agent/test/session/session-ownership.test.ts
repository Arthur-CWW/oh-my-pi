import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	acquireSessionOwnership,
	decodeSessionLeaseV1,
	ExternalSessionOwnerUnverifiable,
	inspectSessionOwnership,
} from "@oh-my-pi/pi-coding-agent/session/session-ownership";

const roots: string[] = [];

async function fixture(): Promise<{ root: string; session: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-owner-"));
	roots.push(root);
	const session = path.join(root, "parent.jsonl");
	await fs.writeFile(session, `${JSON.stringify({ type: "session", id: "parent" })}\n`);
	return { root, session };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("owners-v1 OMP guard", () => {
	it("uses the closed v1 decoder", () => {
		expect(decodeSessionLeaseV1({ version: 1 })).toBeNull();
	});

	it("acquires and releases only its own epoch", async () => {
		const { root, session } = await fixture();
		const ownership = await acquireSessionOwnership(session, "parent", { root });
		expect(await ownership.isCurrent()).toBe(true);
		await ownership.release();
		expect(await inspectSessionOwnership(session, "parent", { root })).toEqual({ status: "none" });
	});

	it("treats a final-component symlink as the same owned journal", async () => {
		const { root, session } = await fixture();
		const symlink = path.join(root, "parent-link.jsonl");
		await fs.symlink(session, symlink);
		const ownership = await acquireSessionOwnership(symlink, "parent", { root });
		expect((await inspectSessionOwnership(session, "parent", { root })).status).toBe("suspect");
		await expect(acquireSessionOwnership(session, "parent", { root })).rejects.toBeInstanceOf(
			ExternalSessionOwnerUnverifiable,
		);
		await ownership.release();
	});

	it("rejects a missing mux-supplied epoch before a direct fallback", async () => {
		const { root, session } = await fixture();
		await expect(
			acquireSessionOwnership(session, "parent", {
				root,
				suppliedEpoch: "mux-epoch",
				suppliedSocket: path.join(root, "sock"),
			}),
		).rejects.toBeInstanceOf(ExternalSessionOwnerUnverifiable);
		expect(await inspectSessionOwnership(session, "parent", { root })).toEqual({ status: "none" });
	});
});
