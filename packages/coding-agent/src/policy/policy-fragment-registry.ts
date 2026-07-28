import { Schema, type SchemaIssue } from "effect";

export type PolicyJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly PolicyJsonValue[]
	| { readonly [key: string]: PolicyJsonValue };

export type PolicyFragmentNamespace = `ext.${string}`;
export type PolicyFragmentMigration = (value: PolicyJsonValue) => PolicyJsonValue;

export interface PolicyFragmentRegistration<Value extends PolicyJsonValue> {
	readonly namespace: PolicyFragmentNamespace;
	readonly registration: string;
	readonly version: number;
	readonly schema: Schema.ConstraintDecoder<Value>;
	readonly migrations?: Readonly<Record<number, PolicyFragmentMigration>>;
}

export class FragmentRegistrationError extends Schema.TaggedErrorClass<FragmentRegistrationError>()(
	"FragmentRegistrationError",
	{
		namespace: Schema.String,
		registration: Schema.String,
		reason: Schema.Literals([
			"invalid-namespace",
			"core-shadow",
			"namespace-collision",
			"invalid-version",
			"missing-migration",
		]),
		owner: Schema.optional(Schema.String),
	},
) {}

export class FragmentValueError extends Schema.TaggedErrorClass<FragmentValueError>()("FragmentValueError", {
	key: Schema.String,
	propertyPath: Schema.String,
	registration: Schema.String,
	reason: Schema.String,
}) {}

interface ActivePolicyFragmentProjection {
	readonly status: "active";
	readonly storedVersion: number;
	readonly currentVersion: number;
	readonly registration: string;
	readonly value: PolicyJsonValue;
	readonly notice: string;
}

interface UnregisteredPolicyFragmentProjection {
	readonly status: "unregistered";
	readonly storedVersion: number;
	readonly currentVersion?: never;
	readonly registration?: never;
	readonly value?: never;
	readonly notice: string;
}

interface NewerPolicyFragmentProjection {
	readonly status: "newer-version";
	readonly storedVersion: number;
	readonly currentVersion: number;
	readonly registration: string;
	readonly value?: never;
	readonly notice: string;
}

interface InvalidPolicyFragmentProjection {
	readonly status: "invalid";
	readonly storedVersion: number;
	readonly currentVersion: number;
	readonly registration: string;
	readonly value?: never;
	readonly notice: string;
}

export type PolicyFragmentProjection =
	| ActivePolicyFragmentProjection
	| UnregisteredPolicyFragmentProjection
	| NewerPolicyFragmentProjection
	| InvalidPolicyFragmentProjection;

const STRICT_DECODE_OPTIONS = { onExcessProperty: "error" } as const;
const EXTENSION_NAMESPACE_PATTERN = /^ext\.[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*$/;
const SIMPLE_PROPERTY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const UNREGISTERED = "unregistered";

function appendPropertyPath(path: string, property: PropertyKey): string {
	if (typeof property === "number") return `${path}[${property}]`;
	const propertyName = typeof property === "symbol" ? String(property.description ?? property) : property;
	return SIMPLE_PROPERTY_PATTERN.test(propertyName)
		? `${path}.${propertyName}`
		: `${path}[${JSON.stringify(propertyName)}]`;
}

function firstIssuePropertyPath(issue: SchemaIssue.Issue, propertyPath = "$"): string {
	switch (issue._tag) {
		case "Pointer":
			for (const property of issue.path) propertyPath = appendPropertyPath(propertyPath, property);
			return firstIssuePropertyPath(issue.issue, propertyPath);
		case "Filter":
		case "Encoding":
			return firstIssuePropertyPath(issue.issue, propertyPath);
		case "Composite":
		case "AnyOf": {
			const first = issue.issues[0];
			return first === undefined ? propertyPath : firstIssuePropertyPath(first, propertyPath);
		}
		default:
			return propertyPath;
	}
}

function invalidProjection(
	storedVersion: number,
	registration: PolicyFragmentRegistration<PolicyJsonValue>,
	notice: string,
): InvalidPolicyFragmentProjection {
	return {
		status: "invalid",
		storedVersion,
		currentVersion: registration.version,
		registration: registration.registration,
		notice,
	};
}

export class PolicyFragmentRegistry {
	readonly #baseDigest: string;
	readonly #registrations = new Map<PolicyFragmentNamespace, PolicyFragmentRegistration<PolicyJsonValue>>();
	readonly #orderedNamespaces: PolicyFragmentNamespace[] = [];
	#digest: string;

	constructor(baseDigest: string) {
		this.#baseDigest = baseDigest;
		this.#digest = baseDigest;
	}

	get digest(): string {
		return this.#digest;
	}

	register<Value extends PolicyJsonValue>(registration: PolicyFragmentRegistration<Value>): void {
		const namespace: string = registration.namespace;
		if (namespace === "core" || namespace.startsWith("core.")) {
			throw new FragmentRegistrationError({
				namespace,
				registration: registration.registration,
				reason: "core-shadow",
			});
		}
		if (!EXTENSION_NAMESPACE_PATTERN.test(namespace)) {
			throw new FragmentRegistrationError({
				namespace,
				registration: registration.registration,
				reason: "invalid-namespace",
			});
		}
		if (!Number.isInteger(registration.version) || registration.version < 1) {
			throw new FragmentRegistrationError({
				namespace,
				registration: registration.registration,
				reason: "invalid-version",
			});
		}

		for (const existingNamespace of this.#orderedNamespaces) {
			if (
				namespace !== existingNamespace &&
				!namespace.startsWith(`${existingNamespace}.`) &&
				!existingNamespace.startsWith(`${namespace}.`)
			) {
				continue;
			}
			const owner = this.#registrations.get(existingNamespace);
			throw new FragmentRegistrationError({
				namespace,
				registration: registration.registration,
				reason: "namespace-collision",
				owner: owner?.registration,
			});
		}

		const migrations: Record<number, PolicyFragmentMigration> = {};
		for (let version = 1; version < registration.version; version += 1) {
			const migration = registration.migrations?.[version];
			if (typeof migration !== "function") {
				throw new FragmentRegistrationError({
					namespace,
					registration: registration.registration,
					reason: "missing-migration",
				});
			}
			migrations[version] = migration;
		}

		const extensionNamespace = namespace as PolicyFragmentNamespace;
		const normalized: PolicyFragmentRegistration<Value> = Object.freeze({
			namespace: extensionNamespace,
			registration: registration.registration,
			version: registration.version,
			schema: registration.schema,
			...(registration.version > 1 ? { migrations: Object.freeze(migrations) } : {}),
		});
		this.#registrations.set(extensionNamespace, normalized as PolicyFragmentRegistration<PolicyJsonValue>);
		this.#orderedNamespaces.push(extensionNamespace);
		this.#orderedNamespaces.sort();
		this.#updateDigest();
	}

	resolve(key: string): PolicyFragmentRegistration<PolicyJsonValue> | undefined {
		for (const namespace of this.#orderedNamespaces) {
			if (key === namespace || key.startsWith(`${namespace}.`)) return this.#registrations.get(namespace);
		}
		return undefined;
	}

	decodeCurrent(key: string, input: PolicyJsonValue): PolicyJsonValue {
		const registration = this.resolve(key);
		if (registration === undefined) {
			throw new FragmentValueError({
				key,
				propertyPath: "$",
				registration: UNREGISTERED,
				reason: key.startsWith("ext.")
					? "extension namespace is not registered"
					: "policy key is not an extension key",
			});
		}
		return this.#decodeRegistered(key, registration, input);
	}

	project(key: string, storedVersion: number, value: PolicyJsonValue): PolicyFragmentProjection {
		const registration = this.resolve(key);
		if (registration === undefined) {
			return {
				status: "unregistered",
				storedVersion,
				notice: `Extension policy fragment ${key} is inert because its namespace is not registered`,
			};
		}
		if (!Number.isInteger(storedVersion) || storedVersion < 1) {
			return invalidProjection(
				storedVersion,
				registration,
				`Extension policy fragment ${key} has an invalid stored version`,
			);
		}
		if (storedVersion > registration.version) {
			return {
				status: "newer-version",
				storedVersion,
				currentVersion: registration.version,
				registration: registration.registration,
				notice: `Extension policy fragment ${key} was written by newer registration version ${storedVersion}`,
			};
		}

		let migrated = value;
		try {
			for (let version = storedVersion; version < registration.version; version += 1) {
				const migration = registration.migrations?.[version];
				if (migration === undefined) {
					return invalidProjection(
						storedVersion,
						registration,
						`Extension policy fragment ${key} has no migration from version ${version}`,
					);
				}
				migrated = migration(migrated);
			}
			const decoded = this.#decodeRegistered(key, registration, migrated);
			return {
				status: "active",
				storedVersion,
				currentVersion: registration.version,
				registration: registration.registration,
				value: decoded,
				notice:
					storedVersion === registration.version
						? `Extension policy fragment ${key} is active`
						: `Extension policy fragment ${key} is active after migration to version ${registration.version}`,
			};
		} catch (error) {
			if (error instanceof FragmentValueError) {
				return invalidProjection(
					storedVersion,
					registration,
					`Extension policy fragment ${key} is invalid at ${error.propertyPath}: ${error.reason}`,
				);
			}
			return invalidProjection(storedVersion, registration, `Extension policy fragment ${key} migration failed`);
		}
	}

	namespaces(): readonly PolicyFragmentNamespace[] {
		return this.#orderedNamespaces.slice();
	}

	#decodeRegistered(
		key: string,
		registration: PolicyFragmentRegistration<PolicyJsonValue>,
		input: PolicyJsonValue,
	): PolicyJsonValue {
		try {
			return Schema.decodeUnknownSync(registration.schema)(input, STRICT_DECODE_OPTIONS);
		} catch (error) {
			if (Schema.isSchemaError(error)) {
				throw new FragmentValueError({
					key,
					propertyPath: firstIssuePropertyPath(error.issue),
					registration: registration.registration,
					reason: error.message,
				});
			}
			throw new FragmentValueError({
				key,
				propertyPath: "$",
				registration: registration.registration,
				reason: "schema decoder could not complete synchronously",
			});
		}
	}

	#updateDigest(): void {
		const digest = new Bun.SHA256();
		digest.update("policy-fragment-registry:v1\0");
		digest.update(this.#baseDigest);
		for (const namespace of this.#orderedNamespaces) {
			const registration = this.#registrations.get(namespace);
			if (registration === undefined) continue;
			digest.update("\0namespace\0");
			digest.update(namespace);
			digest.update("\0registration\0");
			digest.update(registration.registration);
			digest.update("\0version\0");
			digest.update(String(registration.version));
		}
		this.#digest = digest.digest("hex");
	}
}
