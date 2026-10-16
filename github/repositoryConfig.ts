/** Onay is the canonical application repository. */
export const DEFAULT_TARGET_REPOSITORY = "erman-ksv/Onay";

/** Prefer the new app setting; keep TEZJET_REPOSITORY for existing Codespaces. */
export function getTargetRepository(env: { ONAY_REPOSITORY?: string; TEZJET_REPOSITORY?: string } = process.env) {
  return env.ONAY_REPOSITORY?.trim() || env.TEZJET_REPOSITORY?.trim() || DEFAULT_TARGET_REPOSITORY;
}
