import type { Problem } from "@mockos/contracts";

export class MockosApiError extends Error {
  readonly problem: Problem;
  readonly status: number;

  constructor(problem: Problem, status = problem.status) {
    super(problem.detail ?? problem.title);
    this.name = "MockosApiError";
    this.problem = problem;
    this.status = status;
  }
}

export class MockosProtocolError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MockosProtocolError";
    this.status = status;
  }
}
