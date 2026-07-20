import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App"
import { installGlobalErrorCapture } from "./error-capture"
import "./index.css"

installGlobalErrorCapture()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
