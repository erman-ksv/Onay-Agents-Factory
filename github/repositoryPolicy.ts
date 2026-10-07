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
