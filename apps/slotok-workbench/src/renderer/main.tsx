import { render } from "solid-js/web"
import { App } from "./App"
import "./styles.css"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Slotok root element not found")
}

render(() => <App />, root)
