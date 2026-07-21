import { CryptoRng, type Rng } from "./determinism";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const base64UrlEncode = (value: Uint8Array): string => {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

export const base64UrlDecode = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid base64url value.");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const utf8Encode = (value: string): Uint8Array => encoder.encode(value);
export const utf8Decode = (value: Uint8Array): string => decoder.decode(value);

export const toArrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

const digestBytes = async (value: string | Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      toArrayBuffer(typeof value === "string" ? encoder.encode(value) : value)
    )
  );

export const sha256 = async (value: string | Uint8Array): Promise<string> =>
  [...(await digestBytes(value))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const sha256Base64Url = async (value: string | Uint8Array): Promise<string> =>
  base64UrlEncode(await digestBytes(value));

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)])
    );
  }
  return value;
};

export const canonicalJson = (value: unknown): string => {
  const serialized = JSON.stringify(sortValue(value));
  if (serialized === undefined) throw new Error("Value cannot be represented as JSON.");
  return serialized;
};

const sensitiveKey =
  /(?:authorization|cookie|password|secret|token|api[-_]?key|credential|private[-_]?key|code)/i;

export const redactSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactSecrets(entry),
    ])
  );
};

export const safeEqual = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

export const randomId = (prefix: string, rng: Rng = new CryptoRng()): string =>
  `${prefix}_${[...rng.bytes(24)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;

/** SHA-256 storage hash. Mock client secrets are high-entropy generated values. */
export const hashSecret = (secret: string): Promise<string> => sha256(secret);

export const verifySecret = async (
  secret: string,
  expectedHash: string
): Promise<boolean> => safeEqual(await hashSecret(secret), expectedHash);

export const pkceS256 = (verifier: string): Promise<string> => {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    throw new Error("PKCE code_verifier must contain 43 to 128 unreserved characters.");
  }
  return sha256Base64Url(verifier);
};

export const verifyPkceS256 = async (
  verifier: string,
  challenge: string
): Promise<boolean> => {
  try {
    return safeEqual(await pkceS256(verifier), challenge);
  } catch {
    return false;
  }
};
