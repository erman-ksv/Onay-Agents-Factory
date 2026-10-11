export const DEFAULT_PROTECTED_BRANCHES = ["main", "master"];

export function assertWritableBranch(branch: string) {
  if (DEFAULT_PROTECTED_BRANCHES.includes(branch)) {
    throw new Error(`Direct writes to protected branch "${branch}" are blocked. Use a feature branch and draft PR.`);
  }
}

export function assertRepositoryAllowed(repository: string, allowedRepositories: string[]) {
  if (!allowedRepositories.includes(repository)) {
    throw new Error(`Repository "${repository}" is not allow-listed for Agent Factory automation.`);
  }
}


/** Resolve the repository allow-list without implicitly trusting a requested target. */
export function resolveAllowedRepositories(configured: string | undefined, defaultRepository: string): string[] {
  const source = configured?.trim() || defaultRepository;
  return [...new Set(source.split(",").map((repository) => repository.trim()).filter(Boolean))];
}
