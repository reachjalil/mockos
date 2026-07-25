const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const serializeValue = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => serializeValue(entry) ?? "null").join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => {
        const serialized = serializeValue(entry);
        return serialized === undefined
          ? undefined
          : `${JSON.stringify(key)}:${serialized}`;
      })
      .filter((field): field is string => field !== undefined);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * F2 canonical JSON uses a locale-independent UTF-16 code-unit order. The older
 * shared helper retains its existing compatibility behavior until a separate
 * persisted-hash migration can be reviewed.
 */
export const canonicalMockLlmJson = (value: unknown): string => {
  const serialized = serializeValue(value);
  if (serialized === undefined) {
    throw new TypeError("Value cannot be represented as canonical mock LLM JSON.");
  }
  return serialized;
};
