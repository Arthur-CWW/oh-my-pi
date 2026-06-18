import { Effect } from "effect"

import { startDevUiServer } from "./dev-ui-server"

await Effect.runPromise(startDevUiServer())
