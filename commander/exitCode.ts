export const COMMANDER_EXIT_CODES = {
  completed: 0,
  unhandledError: 1,
  blocked: 10,
  needsReview: 11,
} as const;

export function commanderExitCode(status: string): number {
  switch (status) {
    case "completed":
    case "ci-passed":
      return COMMANDER_EXIT_CODES.completed;
    case "blocked":
    case "ci-repair":
    case "test-evidence-blocked":
    case "no-change":
      return COMMANDER_EXIT_CODES.blocked;
    case "needs-review":
    case "ci-blocked":
      return COMMANDER_EXIT_CODES.needsReview;
    default:
      return COMMANDER_EXIT_CODES.unhandledError;
  }
}

export const AI_MODE_STATUS = "needs-review";
