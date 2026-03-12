import { Schema } from "effect";

export const VideoFrameSchema = Schema.Struct({
	data: Schema.String,
	mimeType: Schema.String,
	timestamp: Schema.String,
});

export const ImageDataSchema = Schema.Struct({
	data: Schema.String,
	mimeType: Schema.String,
});

export const ExtractedContentSchema = Schema.Struct({
	url: Schema.String,
	title: Schema.String,
	content: Schema.String,
	error: Schema.Union([Schema.String, Schema.Null]),
	thumbnail: Schema.optional(ImageDataSchema),
	frames: Schema.optional(Schema.Array(VideoFrameSchema)),
	duration: Schema.optional(Schema.Number),
});

export const FrameErrorSchema = Schema.Struct({
	error: Schema.String,
});

export const FrameResultSchema = Schema.Union([ImageDataSchema, FrameErrorSchema]);

export type VideoFrame = typeof VideoFrameSchema.Type;
export type ImageData = typeof ImageDataSchema.Type;
export type ExtractedContent = typeof ExtractedContentSchema.Type;
export type FrameResult = typeof FrameResultSchema.Type;
