/** Canonical application repository. */
export const DEFAULT_TARGET_REPOSITORY = "erman-ksv/Onay";

export function getTargetRepository(env: { ONAY_REPOSITORY?: string } = process.env) {
  return env.ONAY_REPOSITORY?.trim() || DEFAULT_TARGET_REPOSITORY;
}
