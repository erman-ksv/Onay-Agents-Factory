export const COMMANDER_EXIT_CODES = {
  completed: 0,
  unhandledError: 1,
  blocked: 10,
  needsReview: 11,
} as const;

export function commanderExitCode(status: string): number {
  switch (status) {
    case "completed":
      return COMMANDER_EXIT_CODES.completed;
    case "blocked":
      return COMMANDER_EXIT_CODES.blocked;
    case "needs-review":
      return COMMANDER_EXIT_CODES.needsReview;
    default:
      return COMMANDER_EXIT_CODES.unhandledError;
  }
}

export const AI_MODE_STATUS = "needs-review";
