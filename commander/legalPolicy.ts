/** Host-only temporary switch. Disabled review must never be reported as approval. */
export function legalAgentEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.AGENT_FACTORY_LEGAL_ENABLED?.trim();
  if (!value || value === "true") return true;
  if (value === "false") return false;
  throw new Error("AGENT_FACTORY_LEGAL_ENABLED must be true or false.");
}
