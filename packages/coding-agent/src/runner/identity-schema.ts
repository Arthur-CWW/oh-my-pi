import { Schema } from "effect";

const ContentDigestSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)));

const UUIDSchema = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)),
);

export const TimestampSchema = Schema.String.pipe(
	Schema.refine((value): value is string => {
		const milliseconds = Date.parse(value);
		return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
	}),
);

export const BuildRevisionSchema = Schema.Struct({
	digest: ContentDigestSchema,
	version: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isTrimmed())),
});
export type BuildRevision = typeof BuildRevisionSchema.Type;

export const RunnerInstanceIdentitySchema = Schema.Struct({
	runnerInstanceId: UUIDSchema,
	startedAt: TimestampSchema,
});
export type RunnerInstanceIdentity = typeof RunnerInstanceIdentitySchema.Type;

export const RunnerIdentitySchema = Schema.Struct({
	buildRevision: BuildRevisionSchema,
	runnerInstance: RunnerInstanceIdentitySchema,
});
export type RunnerIdentity = typeof RunnerIdentitySchema.Type;
