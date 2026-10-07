import { TezJetRepositoryAdapter } from "./tezjetRepository.js";

export async function prepareTezJetChange(input: {
  branch: string;
  title: string;
  body: string;
  files: Array<{ path: string; content: string; message: string }>;
}) {
  const repository = process.env.TEZJET_REPOSITORY ?? "erman-ksv/TezJet";
  const adapter = new TezJetRepositoryAdapter(repository);

  await adapter.prepareBranch(input.branch, "main");

  for (const file of input.files) {
    await adapter.write(file.path, file.content, file.message, input.branch);
  }

  return adapter.openDraftPullRequest(input.branch, input.title, input.body);
}
