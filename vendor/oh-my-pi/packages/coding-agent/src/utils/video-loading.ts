import type { VideoMimeType } from "@oh-my-pi/pi-ai";

export const VIDEO_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, VideoMimeType>> = Object.freeze({
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".m4v": "video/x-m4v",
	".webm": "video/webm",
});

export function videoMimeTypeForExtension(extension: string): VideoMimeType | undefined {
	return VIDEO_MIME_TYPE_BY_EXTENSION[extension.toLowerCase()];
}
