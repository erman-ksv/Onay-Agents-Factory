import { createHash } from "node:crypto";
import type { ProposedChange } from "../agents/backend/coder.js";
import { scanForSecrets } from "../github/secretScanner.js";

export type BoundedPatch = {
  path: string;
  sourceSha256: string;
  edits: Array<{ before: string; after: string }>;
  message: string;
};

export const BOUNDED_PATCH_LIMITS = Object.freeze({
  files: 3,
  editsPerFile: 8,
  changedCharacters: 12_000,
  fileBytes: 128 * 1024,
  messageCharacters: 600,
});
export const BOUNDED_PATCH_ERROR = "Bounded patch rejected: invalid, stale, ambiguous, or over-budget changes.";
const fail = (): never => { throw new Error(BOUNDED_PATCH_ERROR); };

function canonicalPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    /^[A-Za-z0-9_@()[\].+ -]+(?:\/[A-Za-z0-9_@()[\].+ -]+)*$/.test(value) &&
    value.split("/").every(part => part !== "." && part !== ".." && part.trim() === part);
}

/** Apply exact, independently anchored replacements against the original host snapshot.
 * No mutation occurs until all anchors have been resolved, and nothing is written here.
 * Newly inserted text can never provide an anchor for a later edit.
 */
export function applyBoundedPatches(
  patches: BoundedPatch[],
  sources: ReadonlyMap<string, string>,
  allowedPaths: readonly string[],
): ProposedChange[] {
  if (!Array.isArray(patches) || patches.length < 1 || patches.length > BOUNDED_PATCH_LIMITS.files ||
    !sources || typeof sources.get !== "function" || typeof sources.has !== "function" ||
    !Array.isArray(allowedPaths) || allowedPaths.some(path => !canonicalPath(path))) fail();
  const allowed = new Set(allowedPaths);
  const seen = new Set<string>();
  let changedCharacters = 0;
  const changes: ProposedChange[] = [];
  for (const patch of patches) {
    if (!patch || !canonicalPath(patch.path) || !allowed.has(patch.path) || seen.has(patch.path) ||
      !sources.has(patch.path) || typeof patch.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(patch.sourceSha256) ||
      typeof patch.message !== "string" || patch.message.trim().length === 0 ||
      patch.message.length > BOUNDED_PATCH_LIMITS.messageCharacters || scanForSecrets(patch.message).length ||
      !Array.isArray(patch.edits) || patch.edits.length < 1 || patch.edits.length > BOUNDED_PATCH_LIMITS.editsPerFile) fail();
    seen.add(patch.path);
    const source = sources.get(patch.path) ?? fail();
    if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > BOUNDED_PATCH_LIMITS.fileBytes ||
      createHash("sha256").update(source, "utf8").digest("hex") !== patch.sourceSha256) fail();
    const replacements: Array<{ start: number; end: number; after: string }> = [];
    for (const edit of patch.edits) {
      if (!edit || typeof edit.before !== "string" || edit.before.length === 0 || typeof edit.after !== "string" ||
        edit.before === edit.after) fail();
      changedCharacters += edit.before.length + edit.after.length;
      if (changedCharacters > BOUNDED_PATCH_LIMITS.changedCharacters || scanForSecrets(edit.before).length || scanForSecrets(edit.after).length) fail();
      const start = source.indexOf(edit.before);
      // Include overlapping matches ("aa" occurs twice in "aaa").
      if (start < 0 || source.indexOf(edit.before, start + 1) !== -1) fail();
      replacements.push({ start, end: start + edit.before.length, after: edit.after });
    }
    replacements.sort((a, b) => a.start - b.start);
    for (let index = 1; index < replacements.length; index++) {
      if (replacements[index].start < replacements[index - 1].end) fail();
    }
    let content = "";
    let offset = 0;
    for (const replacement of replacements) {
      content += source.slice(offset, replacement.start) + replacement.after;
      offset = replacement.end;
    }
    content += source.slice(offset);
    if (content === source || Buffer.byteLength(content, "utf8") > BOUNDED_PATCH_LIMITS.fileBytes || scanForSecrets(content).length) fail();
    changes.push({ path: patch.path, content, message: patch.message });
  }
  return changes;
}
