/** The application still lives under TezJet until its separate repository rename. */
export const DEFAULT_TARGET_REPOSITORY = "erman-ksv/TezJet";

/** Prefer the new app setting; keep TEZJET_REPOSITORY for older Codespaces. */
export function getTargetRepository(env: { ONAY_REPOSITORY?: string; TEZJET_REPOSITORY?: string } = process.env) {
  return env.ONAY_REPOSITORY?.trim() || env.TEZJET_REPOSITORY?.trim() || DEFAULT_TARGET_REPOSITORY;
}
