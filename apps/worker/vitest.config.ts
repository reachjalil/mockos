import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { API_KEY: "mockos-integration-test-key" },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
