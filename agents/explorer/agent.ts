import { OnayRepositoryAdapter } from "../../github/onayRepository.js";

export type ExplorationResult = {
  agent: "explorer";
  repository: string;
  ref: string;
  files: Array<{ path: string; sha: string; content: string }>;
};

export async function exploreRepository(
  paths: string[],
  ref = "main",
  repository = process.env.ONAY_REPOSITORY ?? "erman-ksv/Onay",
): Promise<ExplorationResult> {
  const github = new OnayRepositoryAdapter(repository);
  const files = [];
  for (const path of paths) {
    files.push(await github.read(path, ref));
  }
  return { agent: "explorer", repository, ref, files };
}

export function runExplorer(input: string) {
  return { agent: "explorer", input, action: "inspect repository" };
}
