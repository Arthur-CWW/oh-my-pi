/// <reference types="vitest/config" />
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
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
