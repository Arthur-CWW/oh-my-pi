import {
	ErrorInbox,
	registerSessionStateCommandRejectionBelt,
} from "../../../src/modes/utils/error-inbox";
import { SessionStateCommandInFlightError } from "../../../src/session/session-manager";

const inbox = new ErrorInbox({ appendCustomEntry: () => crypto.randomUUID() });
const unregister = registerSessionStateCommandRejectionBelt(inbox, "session-process-proof");

void Promise.reject(new SessionStateCommandInFlightError("restart-command"));
await Bun.sleep(25);
void Promise.reject(new SessionStateCommandInFlightError("restart-command"));
await Bun.sleep(25);

unregister();
process.stdout.write(`${JSON.stringify(inbox.getErrors())}\n`);
