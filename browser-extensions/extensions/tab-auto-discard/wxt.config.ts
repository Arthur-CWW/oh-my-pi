import { defineConfig } from "wxt";

export default defineConfig({
  manifest: ({ browser }) => ({
    name: "Tab Auto-Discard",
    description: "Discard idle matching tabs with the browser's native tab discard API.",
    permissions: ["alarms", "storage", "tabs"],
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              data_collection_permissions: {
                required: ["none"],
              },
            },
          },
        }
      : {}),
  }),
});
