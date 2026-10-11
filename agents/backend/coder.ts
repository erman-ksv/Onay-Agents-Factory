import { Agent, run } from "@openai/agents";
import { configureModelProvider } from "../../commander/modelProvider.js";

const provider = configureModelProvider();
const modelOptions = provider.provider === "gemini" ? { model: provider.model } : {};

export type ProposedChange = { path: string; content: string; message: string };
export type CoderResult = { summary: string; files: ProposedChange[] };

const coder = new Agent({
  ...modelOptions,
  name: "TezJet Coder",
  instructions: [
    "You are a senior TezJet implementation engineer.",
    "Use the supplied repository context and requested goal to produce a minimal safe change set.",
    "Preserve existing business rules and public APIs unless the goal requires otherwise.",
    "Return ONLY valid JSON with this shape: {summary:string,files:[{path:string,content:string,message:string}]} .",
    "Never include secrets, tokens, .env files, generated dependencies, or unrelated formatting changes.",
    "Return complete file contents for every changed file, not patches.",
    "If the context is insufficient, return an empty files array and explain why in summary.",
  ].join("\n"),
});

export async function generateChanges(goal: string, repositoryContext: string): Promise<CoderResult> {
  if (provider.provider === "none") {
    throw new Error("AI code generation requires GEMINI_API_KEY or OPENAI_API_KEY in the Agent Factory runtime.");
  }
  const result = await run(coder, `GOAL:\n${goal}\n\nREPOSITORY CONTEXT:\n${repositoryContext}`);
  const raw = String(result.finalOutput ?? "").trim();
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as CoderResult;
  if (!parsed || !Array.isArray(parsed.files)) throw new Error("Coder returned an invalid change set");
  return parsed;
}
