const UINT32_RANGE = 0x1_0000_0000;

const seedWords = (seed: string): [number, number, number, number] => {
  let hash = 2_166_136_261;
  const words: number[] = [];
  for (let round = 0; round < 4; round += 1) {
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index) + round;
      hash = Math.imul(hash, 16_777_619);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 2_246_822_507);
    hash ^= hash >>> 13;
    words.push(hash >>> 0);
  }
  const combined = words.reduce((value, word) => value | word, 0);
  if (combined === 0) words[0] = 1;
  return [words[0] ?? 1, words[1] ?? 0, words[2] ?? 0, words[3] ?? 0];
};

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  #nowMs: number;

  constructor(now: Date | string | number) {
    this.#nowMs = new Date(now).getTime();
    if (!Number.isFinite(this.#nowMs))
      throw new Error("FixedClock needs a valid date.");
  }

  now(): Date {
    return new Date(this.#nowMs);
  }

  set(now: Date | string | number): void {
    const value = new Date(now).getTime();
    if (!Number.isFinite(value)) throw new Error("FixedClock needs a valid date.");
    this.#nowMs = value;
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds)) throw new Error("Advance must be finite.");
    this.#nowMs += milliseconds;
  }
}

export interface Rng {
  next(): number;
  bytes(length: number): Uint8Array;
}

const bytesToUuid = (bytes: Uint8Array): string => {
  const value = bytes.slice(0, 16);
  value[6] = ((value[6] ?? 0) & 0x0f) | 0x40;
  value[8] = ((value[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...value].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};

export const uuidFromRng = (rng: Rng): string => bytesToUuid(rng.bytes(16));

export class CryptoRng implements Rng {
  next(): number {
    const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    return value / UINT32_RANGE;
  }

  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error("Byte length must be a non-negative safe integer.");
    }
    return crypto.getRandomValues(new Uint8Array(length));
  }

  uuid(): string {
    return crypto.randomUUID();
  }
}

/** Seeded xoshiro128** generator. Same seed and call order produce identical data. */
export class SeededRng implements Rng {
  readonly #state: Uint32Array;

  constructor(seed: string) {
    this.#state = new Uint32Array(seedWords(seed));
  }

  next(): number {
    const state = this.#state;
    const s0 = state[0] ?? 0;
    const s1 = state[1] ?? 0;
    const s2 = state[2] ?? 0;
    const s3 = state[3] ?? 0;
    const result = Math.imul(
      ((Math.imul(s1, 5) << 7) | (Math.imul(s1, 5) >>> 25)) >>> 0,
      9
    );
    const temporary = (s1 << 9) >>> 0;
    state[2] = (s2 ^ s0) >>> 0;
    state[3] = (s3 ^ s1) >>> 0;
    state[1] = (s1 ^ (state[2] ?? 0)) >>> 0;
    state[0] = (s0 ^ (state[3] ?? 0)) >>> 0;
    state[2] = ((state[2] ?? 0) ^ temporary) >>> 0;
    const rotated = state[3] ?? 0;
    state[3] = ((rotated << 11) | (rotated >>> 21)) >>> 0;
    return (result >>> 0) / UINT32_RANGE;
  }

  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error("Byte length must be a non-negative safe integer.");
    }
    const output = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      output[index] = Math.floor(this.next() * 256);
    }
    return output;
  }

  uuid(): string {
    return uuidFromRng(this);
  }
}

export const createDeterministicId = (prefix: string, rng: Rng): string =>
  `${prefix}_${[...rng.bytes(16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;

/** Stable tenant UUID seam; callers persist only the resulting UUID. */
export const createTenantId = (environmentSeed: string): string =>
  uuidFromRng(new SeededRng(`mockos:tenant:${environmentSeed}`));
