const bytesToHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Derives a bounded, non-reversible Workflow/run identifier from the caller's
 * retry key and the selected Environment. The clear-text key never enters
 * Workflow parameters, results, logs, or persisted run state.
 */
export const provisioningRunIdForRequest = async (
  environmentId: string,
  idempotencyKey: string | undefined
): Promise<string> => {
  if (!idempotencyKey) {
    return `run_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${environmentId}\0${idempotencyKey}`)
    )
  );
  return `run_${bytesToHex(digest)}`;
};
