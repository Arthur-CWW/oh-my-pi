/// <reference types="vitest/config" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import solid from "vite-plugin-solid"

const reactRouteFiles = [
  /src\/renderer\/ReactUgcStudio\.tsx/,
  /src\/renderer\/components\/ui\/.*\.tsx/,
]

export default defineConfig({
  plugins: [
    react({ include: reactRouteFiles }),
    solid({ exclude: reactRouteFiles }),
  ],
  root: ".",
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 47521,
    strictPort: true,
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
