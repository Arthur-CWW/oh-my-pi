import { describe, expect, it } from "bun:test";
import {
	BlobStore,
	blobExtensionForMimeType,
	externalizeImageDataUrl,
	externalizeMediaData,
	isBlobRef,
	parseBlobRef,
	resolveImageDataUrl,
	resolveMediaData,
} from "@oh-my-pi/pi-coding-agent/session/blob-store";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("BlobStore media display paths", () => {
	it("creates an extension-bearing sidecar for image blobs while keeping canonical refs extensionless", async () => {
		using tempDir = TempDir.createSync("@omp-blob-store-image-link-");
		const store = new BlobStore(tempDir.path());
		const data = Buffer.from("image-bytes");

		const result = await store.put(data, { extension: "png" });
		expect(result.path.endsWith(result.hash)).toBe(true);
		expect(result.displayPath).toBe(`${result.path}.png`);
		expect(parseBlobRef(result.ref)).toBe(result.hash);
		expect(await Bun.file(result.path).bytes()).toEqual(new Uint8Array(data));
		expect(await Bun.file(result.displayPath).bytes()).toEqual(new Uint8Array(data));
	});

	it("externalizes and restores image data URLs without losing their transport prefix", async () => {
		using tempDir = TempDir.createSync("@omp-blob-store-image-url-");
		const store = new BlobStore(tempDir.path());
		const dataUrl = "data:image/png;base64,aW1hZ2UtYnl0ZXM=";

		const ref = await externalizeImageDataUrl(store, dataUrl);

		expect(isBlobRef(ref)).toBe(true);
		expect(await resolveImageDataUrl(store, ref)).toBe(dataUrl);
	});

	it("deduplicates mixed image and video bytes while preserving typed display sidecars", async () => {
		using tempDir = TempDir.createSync("@omp-blob-store-media-link-");
		const store = new BlobStore(tempDir.path());
		const base64 = Buffer.from("shared-media-bytes").toString("base64");

		const imageRef = await externalizeMediaData(store, base64, "image/png");
		const videoRef = await externalizeMediaData(store, base64, "video/mp4");
		const hash = parseBlobRef(imageRef);

		expect(videoRef).toBe(imageRef);
		expect(hash).toBeTruthy();
		expect(await Bun.file(`${tempDir.path()}/${hash}.png`).bytes()).toEqual(
			new Uint8Array(Buffer.from(base64, "base64")),
		);
		expect(await Bun.file(`${tempDir.path()}/${hash}.mp4`).bytes()).toEqual(
			new Uint8Array(Buffer.from(base64, "base64")),
		);
		expect(await resolveMediaData(store, videoRef)).toBe(base64);
	});

	it("rejects malformed hashes and reports missing canonical blobs", async () => {
		using tempDir = TempDir.createSync("@omp-blob-store-invalid-");
		const store = new BlobStore(tempDir.path());

		await expect(store.get("not-a-sha256-hash")).rejects.toThrow("Invalid blob hash");
		await expect(resolveMediaData(store, `blob:sha256:${"f".repeat(64)}`)).rejects.toThrow("Missing blob");
	});

	it("maps common media mime types to clickable file extensions", () => {
		expect(blobExtensionForMimeType("image/jpeg")).toBe("jpg");
		expect(blobExtensionForMimeType("image/png")).toBe("png");
		expect(blobExtensionForMimeType("video/mp4")).toBe("mp4");
		expect(blobExtensionForMimeType("video/quicktime")).toBe("mov");
		expect(blobExtensionForMimeType("video/x-m4v")).toBe("m4v");
		expect(blobExtensionForMimeType("video/webm")).toBe("webm");
		expect(blobExtensionForMimeType("video/not-supported")).toBeUndefined();
		expect(blobExtensionForMimeType("text/plain")).toBeUndefined();
	});
	it("accepts only canonical lowercase SHA-256 blob references", () => {
		expect(isBlobRef("blob:sha256:" + "a".repeat(64))).toBe(true);
		expect(isBlobRef("blob:sha256:" + "A".repeat(64))).toBe(false);
		expect(isBlobRef("blob:sha256:" + "a".repeat(63))).toBe(false);
		expect(isBlobRef("blob:sha256:" + "a".repeat(64) + ".mp4")).toBe(false);
	});
});
