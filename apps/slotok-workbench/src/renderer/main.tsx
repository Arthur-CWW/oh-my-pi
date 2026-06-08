import { render } from "solid-js/web"
import { App } from "./App"
import "./styles.css"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Slotok root element not found")
}

const path = window.location.pathname

render(() => {
  if (path === "/solid" || path.startsWith("/solid/")) {
    return <App />
  }
  return <RouteIndex />
}, root)

function RouteIndex() {
  return (
    <main class="route-index">
      <section class="route-index-card">
        <p class="kicker">Slotok design lab</p>
        <h1>Choose a workbench surface</h1>
        <p>
          The current SolidJS implementation is preserved under its own route prefix so visual QA can compare it against future React/shadcn/Tailwind experiments.
        </p>
        <div class="route-link-list">
          <a href="/solid/">
            <strong>SolidJS review canvas</strong>
            <span>Current implementation: playable video, formatted JSON, compact element queue.</span>
          </a>
          <a href="/design-lab/react-shadcn-tailwind.html">
            <strong>React/shadcn/Tailwind design lab</strong>
            <span>Static prototype endpoint for comparing layout direction before a full stack switch.</span>
          </a>
        </div>
      </section>
    </main>
  )
}
