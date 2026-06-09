import * as React from "react"
import { createRoot } from "react-dom/client"
import { ReactUgcStudio } from "./ReactUgcStudio"
import "./styles.css"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Slotok root element not found")
}

createRoot(root).render(React.createElement(ReactUgcStudio))
