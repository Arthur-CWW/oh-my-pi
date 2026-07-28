import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { sqliteAtomicityScenario } from "../scenarios/sqlite-atomicity"
import type { ScenarioDefinition } from "./scenario"

const scenariosDir = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios")

export interface RegisteredScenario {
	readonly definition: ScenarioDefinition
	readonly modulePath: string
}

/**
 * Adding a scenario is two edits: drop `scenarios/<id>.ts` exporting a `ScenarioDefinition`
 * (plus a `scenarios/<id>/` payload directory), then add one line here.
 */
export const scenarioRegistry: ReadonlyMap<string, RegisteredScenario> = new Map([
	[
		sqliteAtomicityScenario.id,
		{
			definition: sqliteAtomicityScenario,
			modulePath: join(scenariosDir, "sqlite-atomicity.ts"),
		},
	],
])
