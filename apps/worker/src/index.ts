import { EnvironmentDurableObject } from "@mockos/worker-kit";
import * as Sentry from "@sentry/cloudflare";
import { type CloudflareEnv, createWorkerApp } from "./app";

let app: ReturnType<typeof createWorkerApp> | undefined;

const handler = {
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    app ??= createWorkerApp();
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<CloudflareEnv>;

export default Sentry.withSentry(
  (env: CloudflareEnv) => ({
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    sendDefaultPii: false,
    tracesSampleRate: 0,
  }),
  handler
);

export { EnvironmentDurableObject };
