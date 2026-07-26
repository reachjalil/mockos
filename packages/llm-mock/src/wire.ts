export type RenderedLlmSseFrame = {
  readonly data: string;
  /**
   * Payload frames participate in configured chunk cadence. Provider envelope,
   * terminal, usage, and sentinel frames are emitted without intentional delay.
   */
  readonly cadence: "immediate" | "payload";
};

export type RenderedLlmWire =
  | {
      readonly kind: "json";
      readonly status: number;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "sse";
      readonly status: 200;
      readonly headers: Readonly<Record<string, string>>;
      readonly frames: readonly RenderedLlmSseFrame[];
    };

export type RenderLlmPlanOptions = {
  readonly stream: boolean;
  /**
   * OpenAI emits a final empty-choice usage chunk only when requested. Anthropic
   * always reports usage in its message events and ignores this option.
   */
  readonly includeUsage?: boolean;
};
