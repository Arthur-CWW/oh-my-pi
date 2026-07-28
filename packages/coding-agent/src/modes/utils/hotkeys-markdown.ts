import type { AppKeybinding, KeybindingsManager } from "../../config/keybindings";
import { renderInteractionMarkdown } from "../interaction-registry";

export interface HotkeysMarkdownBindings {
	keybindings: Pick<KeybindingsManager, "getDisplayString">;
}

function appKey(bindings: HotkeysMarkdownBindings, action: AppKeybinding): string {
	return bindings.keybindings.getDisplayString(action) || "Disabled";
}

export function buildHotkeysMarkdown(bindings: HotkeysMarkdownBindings): string {
	const interactionMarkdown = renderInteractionMarkdown(
		[
			{ title: "Read-only viewer", surfaces: ["viewer"] },
			{ title: "Agent Hub", surfaces: ["hub.table", "hub.chat", "hub.inspector"] },
			{ title: "Command line", surfaces: ["command-line"], modes: ["input", "completion"] },
		],
		action => bindings.keybindings.getDisplayString(action) || "Disabled",
	);
	return [
		"**Navigation**",
		"| Key | Action |",
		"|-----|--------|",
		"| `Arrow keys` | Move cursor / browse history (Up when empty) |",
		"| `Option+Left/Right` | Move by word |",
		"| `Ctrl+A` / `Home` / `Cmd+Left` | Start of line |",
		"| `Ctrl+E` / `End` / `Cmd+Right` | End of line |",
		"",
		interactionMarkdown,
		"",
		"**Editing**",
		"| Key | Action |",
		"|-----|--------|",
		"| `Enter` | Send message |",
		"| `Shift+Enter` / `Alt+Enter` | New line |",
		"| `Ctrl+W` / `Option+Backspace` | Delete word backwards |",
		"| `Ctrl+U` | Delete to start of line |",
		"| `Ctrl+K` | Delete to end of line |",
		`| \`${appKey(bindings, "app.clipboard.copyLine")}\` | Copy current line |`,
		`| \`${appKey(bindings, "app.clipboard.copyPrompt")}\` | Copy whole prompt |`,
		"",
		"**Other**",
		"| Key | Action |",
		"|-----|--------|",
		"| `Tab` | Path completion / accept autocomplete |",
		`| \`${appKey(bindings, "ui.dismiss")}\` | Dismiss autocomplete / active UI |`,
		`| \`${appKey(bindings, "app.interrupt")}\` | Interrupt active work |`,
		`| \`${appKey(bindings, "app.clear")}\` | Clear editor (first) / exit (second) |`,
		`| \`${appKey(bindings, "app.exit")}\` | Exit (when editor is empty) |`,
		`| \`${appKey(bindings, "app.suspend")}\` | Suspend to background |`,
		`| \`${appKey(bindings, "app.display.reset")}\` | Reset terminal display |`,
		`| \`${appKey(bindings, "app.transcript.rawToggle")}\` | Toggle raw semantic transcript |`,
		`| \`${appKey(bindings, "app.thinking.cycle")}\` | Cycle thinking level |`,
		`| \`${appKey(bindings, "app.model.cycleForward")}\` | Cycle role models (slow/default/smol) |`,
		`| \`${appKey(bindings, "app.model.cycleBackward")}\` | Cycle role models (backward) |`,
		`| \`${appKey(bindings, "app.model.selectTemporary")}\` | Select model (temporary) |`,
		`| \`${appKey(bindings, "app.model.select")}\` | Select model (set roles) |`,
		`| \`${appKey(bindings, "app.plan.toggle")}\` | Toggle plan mode |`,
		`| \`${appKey(bindings, "app.history.search")}\` | Search prompt history |`,
		`| \`${appKey(bindings, "app.tools.expand")}\` | Toggle tool output expansion |`,
		`| \`${appKey(bindings, "app.thinking.toggle")}\` | Toggle thinking block visibility |`,
		`| \`${appKey(bindings, "app.editor.external")}\` | Edit message in external editor |`,
		`| \`${appKey(bindings, "app.clipboard.pasteImage")}\` | Paste image or text from clipboard |`,
		"| Hold `Space` | Speech-to-text (push-to-talk): hold to record, release to transcribe |",
		`| \`${appKey(bindings, "app.agents.hub")}\` / \`${appKey(bindings, "app.session.observe")}\` / double-tap \`←\` (empty editor) | Open the agent hub |`,
		`| \`${appKey(bindings, "app.primitives.inspect")}\` / \`:inspect\` | Open the read-only primitives inspector |`,
		"| `#` | Open prompt actions |",
		"| `/` | Slash commands |",
		"| `!` | Run bash command |",
		"| `!!` | Run bash command (excluded from context) |",
		"| `$` | Run Python in shared kernel |",
		"| `$$` | Run Python (excluded from context) |",
	].join("\n");
}
