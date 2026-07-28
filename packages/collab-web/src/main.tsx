import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/tokens.css";
import "./styles/base.css";
try {
	const response = await fetch("/config");
	if (response.ok) {
		const config = (await response.json()) as { relay?: unknown };
		if (typeof config.relay === "string") globalThis.__OMP_COLLAB_RELAY__ = config.relay;
	}
} catch {
	// Static deployments have no runtime config endpoint and use the public relay.
}


const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");
createRoot(root).render(<App />);
