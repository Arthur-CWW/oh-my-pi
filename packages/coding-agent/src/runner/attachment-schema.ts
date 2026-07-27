import { decodedBase64ByteLength, type VideoMimeType } from "@oh-my-pi/pi-ai";
import { Schema } from "effect";

const VIDEO_MIME_TYPES = [
	"video/mp4",
	"video/quicktime",
	"video/x-m4v",
	"video/webm",
] as const satisfies readonly VideoMimeType[];

const VideoDataSchema = Schema.String.pipe(
	Schema.refine((value): value is string => {
		if (value.length === 0) return false;
		try {
			decodedBase64ByteLength(value);
			return true;
		} catch {
			return false;
		}
	}),
);

const ImageContentSchema = Schema.Struct({
	type: Schema.Literal("image"),
	data: Schema.String,
	mimeType: Schema.String,
	detail: Schema.optional(Schema.Literals(["auto", "low", "high", "original"])),
});

const VideoContentSchema = Schema.Struct({
	type: Schema.Literal("video"),
	data: VideoDataSchema,
	mimeType: Schema.Literals(VIDEO_MIME_TYPES),
});

export const MediaContentSchema = Schema.Union([ImageContentSchema, VideoContentSchema]);

export const InputPayloadSchema = Schema.Struct({
	text: Schema.String,
	attachments: Schema.optional(Schema.Array(MediaContentSchema)),
});
