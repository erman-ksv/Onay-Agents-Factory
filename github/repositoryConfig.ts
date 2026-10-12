export const DEFAULT_TARGET_REPOSITORY = "erman-ksv/TezJet";

export function getTargetRepository(env: { TEZJET_REPOSITORY?: string } = process.env) {
  return env.TEZJET_REPOSITORY?.trim() || DEFAULT_TARGET_REPOSITORY;
}
