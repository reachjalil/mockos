import { DurableObject } from "cloudflare:workers";
import {
  createTargetApp,
  type TargetAppBindings,
  TargetAppState,
  type TargetAppStateSnapshot,
} from "./app";

const STATE_KEY = "target-app-state-v1";

export type TargetWorkerBindings = TargetAppBindings & {
  TARGET_STATE: DurableObjectNamespace<TargetAppDurableObject>;
};

export class TargetAppDurableObject extends DurableObject<TargetAppBindings> {
  readonly #state = new TargetAppState();
  readonly #target = createTargetApp(this.#state);
  readonly #ready: Promise<void>;

  constructor(context: DurableObjectState, env: TargetAppBindings) {
    super(context, env);
    this.#ready = context.blockConcurrencyWhile(async () => {
      const snapshot = await context.storage.get<TargetAppStateSnapshot>(STATE_KEY);
      if (snapshot) this.#state.restore(snapshot);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    await this.#ready;
    const response = await this.#target.app.fetch(request, this.env);
    await this.ctx.storage.put(STATE_KEY, this.#state.snapshot());
    return response;
  }
}

const handler = {
  fetch(request: Request, env: TargetWorkerBindings) {
    const id = env.TARGET_STATE.idFromName("singleton");
    return env.TARGET_STATE.get(id).fetch(request);
  },
} satisfies ExportedHandler<TargetWorkerBindings>;

export default handler;
export type {
  CapturedScimRequest,
  TargetAppBindings,
  TargetAppStateSnapshot,
  TargetScimResource,
} from "./app";
export { createTargetApp, TargetAppState } from "./app";
