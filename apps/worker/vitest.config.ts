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
    // Cold workerd starts and RSA-2048 generation are materially slower on the
    // shared Linux runner than on a warm local machine. Keep the integration
    // suite bounded without relying on Vitest's unit-test-oriented 5s default.
    testTimeout: 15_000,
  },
});
