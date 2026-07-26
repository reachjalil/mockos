import { DEFAULT_F_SERIES_FEATURE_FLAGS } from "@mockos/contracts/features";

export const MOCKOS_CODE_MODE_DEFAULT_ENABLED = DEFAULT_F_SERIES_FEATURE_FLAGS.codeMode;

export class MockosCodeModeDisabledError extends Error {
  constructor() {
    super(
      "mockOS Code Mode is disabled. It requires an explicit feature enablement and qualified sandbox."
    );
    this.name = "MockosCodeModeDisabledError";
  }
}

export function requireMockosCodeModeEnabled(
  enabled: boolean | undefined
): asserts enabled is true {
  if (enabled !== true) throw new MockosCodeModeDisabledError();
}
