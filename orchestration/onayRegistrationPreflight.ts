/**
 * Read-only preflight for the first real Onay registration task.
 * NO model calls, publication, or private source sent to AI.
 * Run from the factory repo with GITHUB_TOKEN configured.
 */
import { GitHubClient } from "../github/githubClient.js";
import {
  ONAY_REPOSITORY, ONAY_TARGET_BRANCH, ONAY_UI_PATH, ONAY_HELPER_PATH, ONAY_TEST_PATH,
} from "./onayRegistrationPatch.js";

const EXPECTED_MAIN_SHA = "1f3d7e1964c9a1f5eab05bc50840d603db15d407";

async function run() {
  const github = new GitHubClient({ repository: ONAY_REPOSITORY });
  const actual = await github.getCommitSha("main");
  console.log("ONAY MAIN:", actual);
  if (actual !== EXPECTED_MAIN_SHA) {
    console.log("PREFLIGHT: BLOCKED — main has moved; explicitly re-review source and base SHA");
    return;
  }
  for (const path of [ONAY_UI_PATH]) {
    const file = await github.getFile(path, EXPECTED_MAIN_SHA);
    console.log("PINNED SOURCE:", path, file.sha, "bytes:", file.content.length);
  }
  for (const path of [ONAY_HELPER_PATH, ONAY_TEST_PATH]) {
    try {
      await github.getFile(path, EXPECTED_MAIN_SHA);
      console.log("PREFLIGHT: BLOCKED — target file already exists:", path);
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.startsWith("GitHub API 404:")) throw error;
    }
  }
  try {
    await github.getCommitSha(ONAY_TARGET_BRANCH);
    console.log("PREFLIGHT: BLOCKED — candidate branch exists; inspect it before any run");
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const absent = message.startsWith("GitHub API 404:") ||
      (message.startsWith("GitHub API 422:") && message.includes("No commit found for SHA: " + ONAY_TARGET_BRANCH));
    if (!absent) throw error;
  }
  console.log("PREFLIGHT: PASS — narrow source and branch checks only");
  console.log("GEMINI CALLS: 0");
  console.log("PRIVATE SOURCE SENT TO AI: NO");
  console.log("GITHUB WRITES: 0");
  console.log("NEXT: explicit separate approval required before implementing live AI task");
}

run().catch(error => {
  console.error("PREFLIGHT: BLOCKED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
