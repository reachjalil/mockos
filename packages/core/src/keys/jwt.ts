import type { Clock, Rng } from "../determinism";
import { SystemClock } from "../determinism";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
  randomId,
  sha256Base64Url,
  toArrayBuffer,
  utf8Decode,
  utf8Encode,
} from "../security";

export interface JwtHeader extends Record<string, unknown> {
  readonly alg: "RS256";
  readonly kid: string;
  readonly typ: "JWT";
}

export type JwtPayload = Record<string, unknown>;

export interface RsaJwk extends JsonWebKey {
  readonly alg: "RS256";
  readonly kid: string;
  readonly use: "sig";
}

export interface SigningKeyPair {
  readonly kid: string;
  readonly algorithm: "RS256";
  readonly publicKey: CryptoKey;
  readonly privateKey: CryptoKey;
  readonly publicJwk: RsaJwk;
  readonly privateJwk: RsaJwk;
}

export interface JsonWebKeySet {
  readonly keys: readonly RsaJwk[];
}

export interface GenerateSigningKeyOptions {
  readonly kid?: string;
  readonly rng?: Rng;
  readonly modulusLength?: 2048 | 3072 | 4096;
}

const rsaAlgorithm = (modulusLength = 2048): RsaHashedKeyGenParams => ({
  name: "RSASSA-PKCS1-v1_5",
  modulusLength,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
});

const signingAlgorithm: RsaPssParams | Algorithm = {
  name: "RSASSA-PKCS1-v1_5",
};

const publicJwkFrom = (jwk: JsonWebKey, kid: string): RsaJwk => ({
  kty: "RSA",
  n: jwk.n,
  e: jwk.e,
  alg: "RS256",
  use: "sig",
  key_ops: ["verify"],
  kid,
});

const privateJwkFrom = (jwk: JsonWebKey, kid: string): RsaJwk => ({
  ...jwk,
  alg: "RS256",
  use: "sig",
  key_ops: ["sign"],
  kid,
});

const jwkThumbprint = (jwk: JsonWebKey): Promise<string> =>
  sha256Base64Url(canonicalJson({ e: jwk.e, kty: "RSA", n: jwk.n }));

export const generateSigningKey = async (
  options: GenerateSigningKeyOptions = {}
): Promise<SigningKeyPair> => {
  const pair = (await crypto.subtle.generateKey(
    rsaAlgorithm(options.modulusLength ?? 2048),
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const rawPublic = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const rawPrivate = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const kid =
    options.kid ??
    (options.rng ? randomId("key", options.rng) : await jwkThumbprint(rawPublic));
  return {
    kid,
    algorithm: "RS256",
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicJwk: publicJwkFrom(rawPublic, kid),
    privateJwk: privateJwkFrom(rawPrivate, kid),
  };
};

export const importSigningKey = async (input: {
  readonly publicJwk: RsaJwk;
  readonly privateJwk: RsaJwk;
}): Promise<SigningKeyPair> => {
  const kid = input.publicJwk.kid ?? input.privateJwk.kid;
  if (!kid) throw new Error("Signing JWK needs a kid.");
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    input.publicJwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"]
  );
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    input.privateJwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"]
  );
  return {
    kid,
    algorithm: "RS256",
    publicKey,
    privateKey,
    publicJwk: publicJwkFrom(input.publicJwk, kid),
    privateJwk: privateJwkFrom(input.privateJwk, kid),
  };
};

export const toPublicJwk = (key: SigningKeyPair | RsaJwk): RsaJwk => {
  if ("publicJwk" in key) return { ...key.publicJwk };
  const kid = key.kid;
  if (!kid) throw new Error("Public JWK needs a kid.");
  return publicJwkFrom(key, kid);
};

export const toJwks = (keys: readonly (SigningKeyPair | RsaJwk)[]): JsonWebKeySet => ({
  keys: keys.map(toPublicJwk),
});

export const signJwt = async (
  payload: JwtPayload,
  key: SigningKeyPair,
  additionalHeader: Readonly<Record<string, unknown>> = {}
): Promise<string> => {
  const header: JwtHeader = {
    ...additionalHeader,
    alg: "RS256",
    kid: key.kid,
    typ: "JWT",
  };
  const encodedHeader = base64UrlEncode(utf8Encode(canonicalJson(header)));
  const encodedPayload = base64UrlEncode(utf8Encode(canonicalJson(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    signingAlgorithm,
    key.privateKey,
    toArrayBuffer(utf8Encode(signingInput))
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
};

const parsePart = (part: string, label: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(utf8Decode(base64UrlDecode(part))) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} is not an object.`);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new JwtVerificationError(`JWT ${label} is invalid.`, { cause: error });
  }
};

export const decodeJwt = (
  token: string
): { header: JwtHeader; payload: JwtPayload; signature: Uint8Array } => {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new JwtVerificationError("JWT must contain three encoded parts.");
  }
  const [encodedHeader = "", encodedPayload = "", encodedSignature = ""] = parts;
  const header = parsePart(encodedHeader, "header");
  if (
    header.alg !== "RS256" ||
    header.typ !== "JWT" ||
    typeof header.kid !== "string"
  ) {
    throw new JwtVerificationError("JWT header is not a supported RS256 header.");
  }
  return {
    header: header as JwtHeader,
    payload: parsePart(encodedPayload, "payload"),
    signature: base64UrlDecode(encodedSignature),
  };
};

export interface VerifyJwtOptions {
  readonly clock?: Clock;
  readonly clockToleranceSeconds?: number;
  readonly issuer?: string;
  readonly audience?: string;
  readonly subject?: string;
  readonly requiredClaims?: readonly string[];
}

export class JwtVerificationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JwtVerificationError";
  }
}

const resolveJwk = (
  key: SigningKeyPair | RsaJwk | JsonWebKeySet,
  kid: string
): RsaJwk | CryptoKey => {
  if ("publicKey" in key) {
    if (key.kid !== kid) throw new JwtVerificationError("JWT kid is not recognized.");
    return key.publicKey;
  }
  if ("keys" in key) {
    const match = key.keys.find((candidate) => candidate.kid === kid);
    if (!match) throw new JwtVerificationError("JWT kid is not recognized.");
    return match;
  }
  if (key.kid !== kid) throw new JwtVerificationError("JWT kid is not recognized.");
  return key;
};

const publicCryptoKey = async (key: RsaJwk | CryptoKey): Promise<CryptoKey> => {
  if ("algorithm" in key && "usages" in key) return key;
  return crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
};

const numericClaim = (payload: JwtPayload, claim: string): number | undefined => {
  const value = payload[claim];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new JwtVerificationError(`JWT ${claim} claim must be numeric.`);
  }
  return value;
};

const audienceMatches = (claim: unknown, expected: string): boolean =>
  claim === expected ||
  (Array.isArray(claim) && claim.every((value) => typeof value === "string")
    ? claim.includes(expected)
    : false);

export const verifyJwt = async (
  token: string,
  key: SigningKeyPair | RsaJwk | JsonWebKeySet,
  options: VerifyJwtOptions = {}
): Promise<JwtPayload> => {
  const { header, payload, signature } = decodeJwt(token);
  const [encodedHeader = "", encodedPayload = ""] = token.split(".");
  const verified = await crypto.subtle.verify(
    signingAlgorithm,
    await publicCryptoKey(resolveJwk(key, header.kid)),
    toArrayBuffer(signature),
    toArrayBuffer(utf8Encode(`${encodedHeader}.${encodedPayload}`))
  );
  if (!verified) throw new JwtVerificationError("JWT signature is invalid.");

  const now = Math.floor((options.clock ?? new SystemClock()).now().getTime() / 1_000);
  const tolerance = options.clockToleranceSeconds ?? 0;
  const expiresAt = numericClaim(payload, "exp");
  const notBefore = numericClaim(payload, "nbf");
  if (expiresAt !== undefined && now - tolerance >= expiresAt) {
    throw new JwtVerificationError("JWT has expired.");
  }
  if (notBefore !== undefined && now + tolerance < notBefore) {
    throw new JwtVerificationError("JWT is not active yet.");
  }
  if (options.issuer !== undefined && payload.iss !== options.issuer) {
    throw new JwtVerificationError("JWT issuer does not match.");
  }
  if (
    options.audience !== undefined &&
    !audienceMatches(payload.aud, options.audience)
  ) {
    throw new JwtVerificationError("JWT audience does not match.");
  }
  if (options.subject !== undefined && payload.sub !== options.subject) {
    throw new JwtVerificationError("JWT subject does not match.");
  }
  for (const claim of options.requiredClaims ?? []) {
    if (payload[claim] === undefined) {
      throw new JwtVerificationError(`JWT is missing required claim: ${claim}.`);
    }
  }
  return payload;
};
