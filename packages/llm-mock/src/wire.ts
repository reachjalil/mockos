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
      readonly frames: readonly string[];
    };

export type RenderLlmPlanOptions = {
  readonly stream: boolean;
  /**
   * OpenAI emits a final empty-choice usage chunk only when requested. Anthropic
   * always reports usage in its message events and ignores this option.
   */
  readonly includeUsage?: boolean;
};
