import {
  MOCK_LLM_MAX_CHUNK_DELAY_MILLISECONDS,
  MOCK_LLM_MAX_INITIAL_DELAY_MILLISECONDS,
  MOCK_LLM_MAX_SEGMENTS,
  MOCK_LLM_MAX_STREAM_CHUNKS,
  MOCK_LLM_MAXIMUM_DURATION_MILLISECONDS,
} from "@mockos/contracts/mock-llm";
import type { RenderedLlmSseFrame } from "./wire";

export const EDGE_SSE_STREAM_MAXIMUM_BYTES = 2 * 1024 * 1024;
export const EDGE_SSE_STREAM_MAXIMUM_FRAMES =
  MOCK_LLM_MAX_STREAM_CHUNKS + 2 * MOCK_LLM_MAX_SEGMENTS + 8;

export type EdgeSseStreamSchedule = {
  readonly initialDelayMilliseconds: number;
  readonly chunkDelayMilliseconds: number;
  readonly maximumDurationMilliseconds: number;
};

export type PrepareEdgeSseStreamOptions = {
  readonly frames: readonly RenderedLlmSseFrame[];
  readonly schedule: EdgeSseStreamSchedule;
  readonly signal: AbortSignal;
  /**
   * A caller-specific total UTF-8 bound. The shared primitive never permits a
   * value above {@link EDGE_SSE_STREAM_MAXIMUM_BYTES}.
   */
  readonly maximumBytes?: number;
  /**
   * Exposed for deterministic edge-runtime tests. Production callers should
   * use the default wall clock.
   */
  readonly now?: () => number;
};

export type EdgeSseStreamTerminalOutcome =
  | "completed"
  | "cancelled"
  | "deadline_exceeded"
  | "failed";

export type EdgeSseStreamTerminalResult = {
  readonly outcome: EdgeSseStreamTerminalOutcome;
  readonly frameCount: number;
  readonly byteLength: number;
  readonly durationMilliseconds: number;
};

export type PreparedEdgeSseStream = {
  readonly byteLength: number;
  readonly frameCount: number;
  /**
   * Undefined until waitForInitialDelay() starts the absolute stream clock.
   */
  readonly startedAtMilliseconds: number | undefined;
  readonly deadlineAtMilliseconds: number | undefined;
  /**
   * Resolves exactly once for initial-delay failures, normal close, request
   * abort, reader cancellation, deadline, or an unknown stream failure.
   */
  readonly terminal: Promise<EdgeSseStreamTerminalResult>;
  /**
   * Must be awaited before response headers are returned. The wait observes
   * both request cancellation and the stream's absolute wall deadline.
   */
  readonly waitForInitialDelay: () => Promise<void>;
  /**
   * Creates the one-shot body after the initial delay has completed.
   */
  readonly createReadableStream: () => ReadableStream<Uint8Array>;
};

export class EdgeSseStreamPreflightError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EdgeSseStreamPreflightError";
  }
}

export class EdgeSseStreamDeadlineError extends Error {
  constructor(message = "The edge SSE stream exceeded its maximum duration.") {
    super(message);
    this.name = "EdgeSseStreamDeadlineError";
  }
}

type EncodedEdgeSseFrame = {
  readonly data: Uint8Array;
  readonly cadence: RenderedLlmSseFrame["cadence"];
};

const abortReason = (): DOMException =>
  new DOMException("The edge SSE stream request was aborted.", "AbortError");

const assertSafeIntegerInRange = (
  value: unknown,
  name: string,
  minimum: number,
  maximum: number
): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new EdgeSseStreamPreflightError(
      `${name} must be a safe integer between ${minimum} and ${maximum}.`
    );
  }
  return value;
};

const assertWellFormedUnicode = (value: string, frameIndex: number): void => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        throw new EdgeSseStreamPreflightError(
          `Edge SSE frame ${frameIndex} contains an unpaired UTF-16 surrogate.`
        );
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new EdgeSseStreamPreflightError(
        `Edge SSE frame ${frameIndex} contains an unpaired UTF-16 surrogate.`
      );
    }
  }
};

const assertSingleSseEvent = (value: string, frameIndex: number): void => {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (!normalized.endsWith("\n\n") || normalized.length === 2) {
    throw new EdgeSseStreamPreflightError(
      `Edge SSE frame ${frameIndex} must contain one non-empty event ending in a blank line.`
    );
  }
  if (normalized.slice(0, -2).includes("\n\n")) {
    throw new EdgeSseStreamPreflightError(
      `Edge SSE frame ${frameIndex} contains more than one event.`
    );
  }
};

const waitUntil = (
  targetMilliseconds: number,
  deadlineMilliseconds: number,
  signal: AbortSignal,
  now: () => number
): Promise<void> => {
  if (signal.aborted) return Promise.reject(abortReason());

  const currentMilliseconds = now();
  if (currentMilliseconds >= deadlineMilliseconds) {
    return Promise.reject(new EdgeSseStreamDeadlineError());
  }
  if (currentMilliseconds >= targetMilliseconds) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    const settle = (operation: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      operation();
    };
    const onAbort = () => settle(() => reject(abortReason()));
    const wake = () => {
      let wakeMilliseconds: number;
      try {
        wakeMilliseconds = now();
      } catch (reason) {
        settle(() => reject(reason));
        return;
      }
      if (wakeMilliseconds >= deadlineMilliseconds) {
        settle(() => reject(new EdgeSseStreamDeadlineError()));
        return;
      }
      if (wakeMilliseconds >= targetMilliseconds) {
        settle(resolve);
        return;
      }
      timeout = setTimeout(
        wake,
        Math.min(
          targetMilliseconds - wakeMilliseconds,
          deadlineMilliseconds - wakeMilliseconds
        )
      );
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    timeout = setTimeout(
      wake,
      Math.min(
        targetMilliseconds - currentMilliseconds,
        deadlineMilliseconds - currentMilliseconds
      )
    );
  });
};

/**
 * Synchronously validates and UTF-8 encodes a complete provider-rendered SSE
 * response. Callers then await the returned initial-delay gate before creating
 * a Response, keeping aborts and deadline failures on the pre-header side.
 */
export const prepareEdgeSseStream = (
  options: PrepareEdgeSseStreamOptions
): PreparedEdgeSseStream => {
  if (!Array.isArray(options.frames) || options.frames.length === 0) {
    throw new EdgeSseStreamPreflightError(
      "An edge SSE stream must contain at least one frame."
    );
  }
  if (options.frames.length > EDGE_SSE_STREAM_MAXIMUM_FRAMES) {
    throw new EdgeSseStreamPreflightError(
      `An edge SSE stream cannot contain more than ${EDGE_SSE_STREAM_MAXIMUM_FRAMES} total frames.`
    );
  }
  const signal = options.signal;
  if (
    signal === undefined ||
    typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function" ||
    typeof signal.removeEventListener !== "function"
  ) {
    throw new EdgeSseStreamPreflightError(
      "An edge SSE stream requires an AbortSignal."
    );
  }

  const maximumBytes = assertSafeIntegerInRange(
    options.maximumBytes ?? EDGE_SSE_STREAM_MAXIMUM_BYTES,
    "maximumBytes",
    1,
    EDGE_SSE_STREAM_MAXIMUM_BYTES
  );
  const initialDelayMilliseconds = assertSafeIntegerInRange(
    options.schedule?.initialDelayMilliseconds,
    "initialDelayMilliseconds",
    0,
    MOCK_LLM_MAX_INITIAL_DELAY_MILLISECONDS
  );
  const chunkDelayMilliseconds = assertSafeIntegerInRange(
    options.schedule?.chunkDelayMilliseconds,
    "chunkDelayMilliseconds",
    0,
    MOCK_LLM_MAX_CHUNK_DELAY_MILLISECONDS
  );
  const maximumDurationMilliseconds = assertSafeIntegerInRange(
    options.schedule?.maximumDurationMilliseconds,
    "maximumDurationMilliseconds",
    1,
    MOCK_LLM_MAXIMUM_DURATION_MILLISECONDS
  );

  const encoder = new TextEncoder();
  const encodedFrames: EncodedEdgeSseFrame[] = [];
  let byteLength = 0;
  let payloadFrameCount = 0;
  for (const [index, frame] of options.frames.entries()) {
    const dataValue =
      frame !== null && typeof frame === "object" && !Array.isArray(frame)
        ? frame.data
        : undefined;
    const cadenceValue =
      frame !== null && typeof frame === "object" && !Array.isArray(frame)
        ? frame.cadence
        : undefined;
    if (
      frame === null ||
      typeof frame !== "object" ||
      Array.isArray(frame) ||
      typeof dataValue !== "string" ||
      (cadenceValue !== "immediate" && cadenceValue !== "payload")
    ) {
      throw new EdgeSseStreamPreflightError(
        `Edge SSE frame ${index} must contain string data and a supported cadence.`
      );
    }
    assertWellFormedUnicode(dataValue, index);
    assertSingleSseEvent(dataValue, index);
    const data = encoder.encode(dataValue);
    byteLength += data.byteLength;
    if (!Number.isSafeInteger(byteLength) || byteLength > maximumBytes) {
      throw new EdgeSseStreamPreflightError(
        `Edge SSE frames exceed the ${maximumBytes}-byte caller limit.`
      );
    }
    if (cadenceValue === "payload") {
      payloadFrameCount += 1;
      if (payloadFrameCount > MOCK_LLM_MAX_STREAM_CHUNKS) {
        throw new EdgeSseStreamPreflightError(
          `An edge SSE stream cannot contain more than ${MOCK_LLM_MAX_STREAM_CHUNKS} payload frames.`
        );
      }
    }
    encodedFrames.push({ data, cadence: cadenceValue });
  }

  const cadenceDelayCount = Math.max(0, payloadFrameCount - 1);
  const minimumDurationMilliseconds =
    initialDelayMilliseconds + cadenceDelayCount * chunkDelayMilliseconds;
  if (
    !Number.isSafeInteger(minimumDurationMilliseconds) ||
    minimumDurationMilliseconds >= maximumDurationMilliseconds
  ) {
    throw new EdgeSseStreamPreflightError(
      "The configured initial delay and payload cadence do not fit inside the maximum stream duration."
    );
  }

  const now = options.now ?? Date.now;
  if (typeof now !== "function") {
    throw new EdgeSseStreamPreflightError(
      "The edge SSE stream clock must be a function."
    );
  }
  let startedAtMilliseconds: number | undefined;
  let deadlineAtMilliseconds: number | undefined;
  let initialDelayEndsAtMilliseconds: number | undefined;
  let initialDelayPromise: Promise<void> | undefined;
  let initialDelayComplete = false;
  let streamCreated = false;
  let emittedFrameCount = 0;
  let emittedByteLength = 0;
  let terminalResult: EdgeSseStreamTerminalResult | undefined;
  let resolveTerminal: ((result: EdgeSseStreamTerminalResult) => void) | undefined;
  const terminal = new Promise<EdgeSseStreamTerminalResult>((resolve) => {
    resolveTerminal = resolve;
  });

  const clock = (): number => {
    const value = now();
    if (!Number.isFinite(value)) {
      throw new EdgeSseStreamPreflightError(
        "The edge SSE stream clock returned a non-finite value."
      );
    }
    return value;
  };

  const terminalOutcome = (reason: unknown): EdgeSseStreamTerminalOutcome => {
    if (
      signal.aborted ||
      (reason instanceof DOMException && reason.name === "AbortError")
    ) {
      return "cancelled";
    }
    if (reason instanceof EdgeSseStreamDeadlineError) {
      return "deadline_exceeded";
    }
    return "failed";
  };

  const settleTerminal = (
    outcome: EdgeSseStreamTerminalOutcome
  ): EdgeSseStreamTerminalResult => {
    if (terminalResult) return terminalResult;
    let durationMilliseconds = 0;
    if (startedAtMilliseconds !== undefined) {
      try {
        durationMilliseconds = Math.max(0, Math.floor(clock() - startedAtMilliseconds));
      } catch {
        // A broken injected clock is itself the failure; retain bounded metadata.
      }
    }
    terminalResult = Object.freeze({
      outcome,
      frameCount: emittedFrameCount,
      byteLength: emittedByteLength,
      durationMilliseconds,
    });
    resolveTerminal?.(terminalResult);
    resolveTerminal = undefined;
    return terminalResult;
  };

  const startClock = (): void => {
    if (startedAtMilliseconds !== undefined) return;
    const started = clock();
    const deadline = started + maximumDurationMilliseconds;
    const initialDelayEnd = started + initialDelayMilliseconds;
    if (!Number.isSafeInteger(deadline) || !Number.isSafeInteger(initialDelayEnd)) {
      throw new EdgeSseStreamPreflightError(
        "The edge SSE stream schedule exceeds the supported clock range."
      );
    }
    startedAtMilliseconds = started;
    deadlineAtMilliseconds = deadline;
    initialDelayEndsAtMilliseconds = initialDelayEnd;
  };

  const waitForInitialDelay = (): Promise<void> => {
    initialDelayPromise ??= (async () => {
      try {
        startClock();
        await waitUntil(
          initialDelayEndsAtMilliseconds as number,
          deadlineAtMilliseconds as number,
          signal,
          clock
        );
        initialDelayComplete = true;
      } catch (reason) {
        settleTerminal(terminalOutcome(reason));
        throw reason;
      }
    })();
    return initialDelayPromise;
  };

  const createReadableStream = (): ReadableStream<Uint8Array> => {
    if (!initialDelayComplete) {
      throw new EdgeSseStreamPreflightError(
        "waitForInitialDelay() must complete before the edge SSE body is created."
      );
    }
    if (streamCreated) {
      throw new EdgeSseStreamPreflightError(
        "A prepared edge SSE stream can create only one body."
      );
    }
    if (signal.aborted) {
      const reason = abortReason();
      settleTerminal("cancelled");
      throw reason;
    }
    try {
      if (clock() >= (deadlineAtMilliseconds as number)) {
        const reason = new EdgeSseStreamDeadlineError();
        settleTerminal("deadline_exceeded");
        throw reason;
      }
    } catch (reason) {
      settleTerminal(terminalOutcome(reason));
      throw reason;
    }
    streamCreated = true;

    let frameIndex = 0;
    let lastPayloadAtMilliseconds: number | undefined;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let deadlineTimeout: ReturnType<typeof setTimeout> | undefined;
    let terminal = false;
    const lifecycle = new AbortController();

    const cleanup = (reason: unknown) => {
      if (deadlineTimeout !== undefined) {
        clearTimeout(deadlineTimeout);
        deadlineTimeout = undefined;
      }
      signal.removeEventListener("abort", onRequestAbort);
      if (!lifecycle.signal.aborted) lifecycle.abort(reason);
    };
    const fail = (reason: unknown) => {
      if (terminal) return;
      terminal = true;
      cleanup(reason);
      settleTerminal(terminalOutcome(reason));
      try {
        streamController?.error(reason);
      } catch {
        // The consumer may already have detached after cancellation.
      }
    };
    const onRequestAbort = () => fail(abortReason());

    return new ReadableStream<Uint8Array>(
      {
        start(controller) {
          streamController = controller;
          signal.addEventListener("abort", onRequestAbort, {
            once: true,
          });
          if (signal.aborted) {
            onRequestAbort();
            return;
          }
          try {
            const remainingMilliseconds = (deadlineAtMilliseconds as number) - clock();
            if (remainingMilliseconds <= 0) {
              fail(new EdgeSseStreamDeadlineError());
              return;
            }
            deadlineTimeout = setTimeout(
              () => fail(new EdgeSseStreamDeadlineError()),
              remainingMilliseconds
            );
          } catch (reason) {
            fail(reason);
          }
        },
        async pull(controller) {
          if (terminal) return;
          try {
            const frame = encodedFrames[frameIndex];
            if (!frame) {
              terminal = true;
              cleanup(new DOMException("The edge SSE stream completed.", "AbortError"));
              controller.close();
              settleTerminal("completed");
              return;
            }

            if (
              frame.cadence === "payload" &&
              lastPayloadAtMilliseconds !== undefined
            ) {
              await waitUntil(
                lastPayloadAtMilliseconds + chunkDelayMilliseconds,
                deadlineAtMilliseconds as number,
                lifecycle.signal,
                clock
              );
              if (terminal) return;
            }

            if (clock() >= (deadlineAtMilliseconds as number)) {
              fail(new EdgeSseStreamDeadlineError());
              return;
            }
            controller.enqueue(frame.data);
            frameIndex += 1;
            emittedFrameCount += 1;
            emittedByteLength += frame.data.byteLength;
            if (frame.cadence === "payload") {
              lastPayloadAtMilliseconds = clock();
            }
            if (frameIndex === encodedFrames.length) {
              terminal = true;
              cleanup(new DOMException("The edge SSE stream completed.", "AbortError"));
              controller.close();
              settleTerminal("completed");
            }
          } catch (reason) {
            fail(reason);
          }
        },
        cancel(reason) {
          if (terminal) return;
          terminal = true;
          cleanup(
            reason ??
              new DOMException("The edge SSE stream was cancelled.", "AbortError")
          );
          settleTerminal("cancelled");
        },
      },
      { highWaterMark: 0 }
    );
  };

  return Object.freeze({
    byteLength,
    frameCount: encodedFrames.length,
    get startedAtMilliseconds() {
      return startedAtMilliseconds;
    },
    get deadlineAtMilliseconds() {
      return deadlineAtMilliseconds;
    },
    terminal,
    waitForInitialDelay,
    createReadableStream,
  });
};
