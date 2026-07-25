import { MOCK_LLM_MAX_STREAM_CHUNKS } from "@mockos/contracts/mock-llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDGE_SSE_STREAM_MAXIMUM_BYTES,
  EDGE_SSE_STREAM_MAXIMUM_FRAMES,
  EdgeSseStreamDeadlineError,
  EdgeSseStreamPreflightError,
  type PrepareEdgeSseStreamOptions,
  prepareEdgeSseStream,
} from "./edge-stream";
import type { RenderedLlmSseFrame } from "./wire";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const immediate = (data: string): RenderedLlmSseFrame => ({
  data,
  cadence: "immediate",
});
const payload = (data: string): RenderedLlmSseFrame => ({
  data,
  cadence: "payload",
});
const options = (
  frames: readonly RenderedLlmSseFrame[],
  overrides: Partial<PrepareEdgeSseStreamOptions> = {}
): PrepareEdgeSseStreamOptions => ({
  frames,
  schedule: {
    initialDelayMilliseconds: 0,
    chunkDelayMilliseconds: 20,
    maximumDurationMilliseconds: 1_000,
  },
  signal: new AbortController().signal,
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("prepareEdgeSseStream", () => {
  it("synchronously preflights frames, UTF-8 bytes, caller bounds, and cadence", () => {
    expect(() => prepareEdgeSseStream(options([]))).toThrow(
      EdgeSseStreamPreflightError
    );
    expect(() =>
      prepareEdgeSseStream(options([immediate("data: one\n\ndata: two\n\n")]))
    ).toThrow(/more than one event/);
    expect(() =>
      prepareEdgeSseStream(options([immediate("data: \ud800\n\n")]))
    ).toThrow(/unpaired UTF-16 surrogate/);
    expect(() =>
      prepareEdgeSseStream(
        options([immediate("data: €\n\n")], {
          maximumBytes: encoder.encode("data: €\n\n").byteLength - 1,
        })
      )
    ).toThrow(/caller limit/);
    expect(() =>
      prepareEdgeSseStream(
        options([payload("data: one\n\n"), payload("data: two\n\n")], {
          schedule: {
            initialDelayMilliseconds: 10,
            chunkDelayMilliseconds: 20,
            maximumDurationMilliseconds: 30,
          },
        })
      )
    ).toThrow(/do not fit/);
    expect(() =>
      prepareEdgeSseStream(
        options([immediate("data: ok\n\n")], {
          maximumBytes: EDGE_SSE_STREAM_MAXIMUM_BYTES + 1,
        })
      )
    ).toThrow(/maximumBytes/);
    expect(() =>
      prepareEdgeSseStream(
        options(
          Array.from({ length: MOCK_LLM_MAX_STREAM_CHUNKS + 1 }, () =>
            immediate(": structural\n\n")
          )
        )
      )
    ).not.toThrow();
    expect(() =>
      prepareEdgeSseStream(
        options(
          Array.from({ length: MOCK_LLM_MAX_STREAM_CHUNKS + 1 }, () =>
            payload("data: x\n\n")
          ),
          {
            schedule: {
              initialDelayMilliseconds: 0,
              chunkDelayMilliseconds: 0,
              maximumDurationMilliseconds: 1_000,
            },
          }
        )
      )
    ).toThrow(/payload frames/);
    expect(() =>
      prepareEdgeSseStream(
        options(
          Array.from({ length: EDGE_SSE_STREAM_MAXIMUM_FRAMES + 1 }, () =>
            immediate(": structural\n\n")
          )
        )
      )
    ).toThrow(/total frames/);

    const prepared = prepareEdgeSseStream(options([immediate("data: €\n\n")]));
    expect(prepared.byteLength).toBe(encoder.encode("data: €\n\n").byteLength);
    expect(prepared.frameCount).toBe(1);
  });

  it("accepts the exact complete UTF-8 ceiling and rejects one byte more", () => {
    const eventOverhead = encoder.encode("data: \n\n").byteLength;
    const exactFrame = immediate(
      `data: ${"x".repeat(EDGE_SSE_STREAM_MAXIMUM_BYTES - eventOverhead)}\n\n`
    );
    const prepared = prepareEdgeSseStream(options([exactFrame]));
    expect(prepared.byteLength).toBe(EDGE_SSE_STREAM_MAXIMUM_BYTES);

    expect(() =>
      prepareEdgeSseStream(
        options([
          immediate(
            `data: ${"x".repeat(EDGE_SSE_STREAM_MAXIMUM_BYTES - eventOverhead + 1)}\n\n`
          ),
        ])
      )
    ).toThrow(/caller limit/);
  });

  it("waits for the initial delay before allowing body creation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const prepared = prepareEdgeSseStream(
      options([immediate("data: ready\n\n")], {
        schedule: {
          initialDelayMilliseconds: 50,
          chunkDelayMilliseconds: 20,
          maximumDurationMilliseconds: 1_000,
        },
      })
    );

    expect(() => prepared.createReadableStream()).toThrow(/waitForInitialDelay/);
    const ready = prepared.waitForInitialDelay();
    await vi.advanceTimersByTimeAsync(49);
    expect(() => prepared.createReadableStream()).toThrow(/waitForInitialDelay/);
    await vi.advanceTimersByTimeAsync(1);
    await ready;

    const reader = prepared.createReadableStream().getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: encoder.encode("data: ready\n\n"),
    });
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts and cleans the pre-header initial-delay gate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(15_000);
    const abortController = new AbortController();
    const removeListener = vi.spyOn(abortController.signal, "removeEventListener");
    const prepared = prepareEdgeSseStream(
      options([immediate("data: never\n\n")], {
        signal: abortController.signal,
        schedule: {
          initialDelayMilliseconds: 50,
          chunkDelayMilliseconds: 0,
          maximumDurationMilliseconds: 1_000,
        },
      })
    );
    const ready = prepared.waitForInitialDelay();
    const reason = new DOMException("request gone", "AbortError");
    abortController.abort(reason);

    await expect(ready).rejects.toMatchObject({ name: "AbortError" });
    await expect(ready).rejects.not.toBe(reason);
    expect(removeListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => prepared.createReadableStream()).toThrow(/waitForInitialDelay/);
  });

  it("is pull-driven, emits one frame per read, and paces only later payload frames", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const prepared = prepareEdgeSseStream(
      options([
        immediate("data: role\n\n"),
        payload("data: payload-1\n\n"),
        immediate("data: metadata\n\n"),
        payload("data: payload-2\n\n"),
        immediate("data: [DONE]\n\n"),
      ])
    );
    await prepared.waitForInitialDelay();
    const reader = prepared.createReadableStream().getReader();

    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: encoder.encode("data: role\n\n"),
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: encoder.encode("data: payload-1\n\n"),
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: encoder.encode("data: metadata\n\n"),
    });

    let secondPayloadSettled = false;
    const secondPayload = reader.read().then((result) => {
      secondPayloadSettled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(19);
    expect(secondPayloadSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(secondPayload).resolves.toMatchObject({
      done: false,
      value: encoder.encode("data: payload-2\n\n"),
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: encoder.encode("data: [DONE]\n\n"),
    });
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses an absolute deadline that includes initial delay and reader stalls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(30_000);
    const prepared = prepareEdgeSseStream(
      options([immediate("data: start\n\n"), immediate("data: supplied-end\n\n")], {
        schedule: {
          initialDelayMilliseconds: 40,
          chunkDelayMilliseconds: 0,
          maximumDurationMilliseconds: 100,
        },
      })
    );
    const ready = prepared.waitForInitialDelay();
    await vi.advanceTimersByTimeAsync(40);
    await ready;
    const reader = prepared.createReadableStream().getReader();

    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: encoder.encode("data: start\n\n"),
    });
    await vi.advanceTimersByTimeAsync(60);
    await expect(reader.read()).rejects.toBeInstanceOf(EdgeSseStreamDeadlineError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates request aborts and cleans timers and listeners", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(40_000);
    const abortController = new AbortController();
    const addListener = vi.spyOn(abortController.signal, "addEventListener");
    const removeListener = vi.spyOn(abortController.signal, "removeEventListener");
    const prepared = prepareEdgeSseStream(
      options([payload("data: start\n\n"), payload("data: end\n\n")], {
        signal: abortController.signal,
      })
    );
    await prepared.waitForInitialDelay();
    const reader = prepared.createReadableStream().getReader();
    await reader.read();
    const pendingRead = reader.read();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(2);

    const reason = new DOMException("request gone", "AbortError");
    abortController.abort(reason);
    await expect(pendingRead).rejects.toMatchObject({ name: "AbortError" });
    await expect(pendingRead).rejects.not.toBe(reason);
    expect(addListener).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans the deadline timer and request listener when the reader cancels", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    const abortController = new AbortController();
    const removeListener = vi.spyOn(abortController.signal, "removeEventListener");
    const prepared = prepareEdgeSseStream(
      options([payload("data: one\n\n"), payload("data: two\n\n")], {
        signal: abortController.signal,
      })
    );
    await prepared.waitForInitialDelay();
    const reader = prepared.createReadableStream().getReader();
    await reader.read();
    const pendingRead = reader.read();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(2);
    await reader.cancel("consumer stopped");

    await expect(pendingRead).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(removeListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never fabricates a terminal frame", async () => {
    const frames = [
      immediate("data: only-caller-frame\n\n"),
    ] satisfies readonly RenderedLlmSseFrame[];
    const prepared = prepareEdgeSseStream(options(frames));
    await prepared.waitForInitialDelay();
    const reader = prepared.createReadableStream().getReader();
    const output: string[] = [];
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      output.push(decoder.decode(result.value));
    }
    expect(output).toEqual(frames.map((frame) => frame.data));
  });
});
