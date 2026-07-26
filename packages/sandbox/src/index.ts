export type SandboxCapabilities = {
  provider: string;
  available: boolean;
  evaluatesJavaScript: boolean;
  enforcesCpuLimit: boolean;
  enforcesSubrequestLimit: boolean;
  blocksOutboundNetwork: boolean;
};

export type SandboxScript = {
  id: string;
  version: number;
  sha256: string;
  source: string;
};

export type SandboxInvocation<Input = unknown> = {
  script: SandboxScript;
  input: Input;
  seed: string;
  now: string;
  signal?: AbortSignal;
};

export type SandboxValidation =
  | { ok: true }
  | {
      ok: false;
      code: "SANDBOX_UNAVAILABLE" | "SCRIPT_INVALID";
      message: string;
    };

export interface SandboxProvider {
  capabilities(): SandboxCapabilities;
  validate(script: SandboxScript): Promise<SandboxValidation>;
  invoke<Input = unknown, Output = unknown>(
    invocation: SandboxInvocation<Input>
  ): Promise<Output>;
}

export class SandboxUnavailableError extends Error {
  readonly code = "SANDBOX_UNAVAILABLE" as const;

  constructor() {
    super(
      "JavaScript behavior is unavailable because no enforcing sandbox is configured."
    );
    this.name = "SandboxUnavailableError";
  }
}

export class NoSandbox implements SandboxProvider {
  capabilities(): SandboxCapabilities {
    return {
      provider: "none",
      available: false,
      evaluatesJavaScript: false,
      enforcesCpuLimit: false,
      enforcesSubrequestLimit: false,
      blocksOutboundNetwork: false,
    };
  }

  async validate(_script: SandboxScript): Promise<SandboxValidation> {
    return {
      ok: false,
      code: "SANDBOX_UNAVAILABLE",
      message:
        "JavaScript behavior requires a qualified sandbox provider; declarative behavior remains available.",
    };
  }

  async invoke<Input = unknown, Output = unknown>(
    _invocation: SandboxInvocation<Input>
  ): Promise<Output> {
    throw new SandboxUnavailableError();
  }
}

export const noSandbox: SandboxProvider = new NoSandbox();
