import { createHash } from "node:crypto";
import { CALCULATOR_PROFILE, refuseCalculatorChange, validateCalculatorScope, type CalculatorScope } from "../config/calculatorProfile.js";
import { scanForSecrets } from "./secretScanner.js";

export type CalculatorTreeEntry = { path: string; sha: string; type: string; mode: string; size?: number };
/** Injected by the trusted host, never exposed as model-controlled arguments. */
export type CalculatorSnapshotReader = {
  getHead(ref: string): Promise<string>;
  readCommit(sha: string): Promise<{ sha: string; treeSha: string }>;
  readTree(sha: string): Promise<{ sha: string; truncated: boolean; tree: CalculatorTreeEntry[] }>;
  readBlob(sha: string): Promise<{ sha: string; encoding: string; content: string }>;
};
export type CalculatorSnapshot = Readonly<{
  repository: string; baseRef: string; baseSha: string; changePaths: readonly string[];
  files: readonly Readonly<{ path: string; exists: boolean; blobSha?: string; sourceSha256?: string }>[];
}>;
const originals = new WeakMap<CalculatorSnapshot, ReadonlyMap<string, string>>();
const shaValid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function treePath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 240 && !/[\u0000-\u001f\u007f\\]/.test(path) &&
    path.split("/").every(part => !!part && part !== "." && part !== "..");
}
function regular(entry: CalculatorTreeEntry): boolean { return entry.type === "blob" && entry.mode === "100644"; }

/** Absence is proven by a complete commit-linked tree, never by a file's 404.
 * The returned capability contains metadata only; originals stay in host memory. */
export async function loadCalculatorSnapshot(scope: CalculatorScope, reader: CalculatorSnapshotReader): Promise<CalculatorSnapshot> {
  validateCalculatorScope(scope);
  // Snapshot the host scope before the first await: a caller cannot widen it mid-read.
  const approved = { ...scope, changePaths: [...scope.changePaths] };
  try {
    if (await reader.getHead(approved.baseRef) !== approved.baseSha) refuseCalculatorChange();
    const commit = await reader.readCommit(approved.baseSha);
    if (commit.sha !== approved.baseSha || !shaValid(commit.treeSha)) refuseCalculatorChange();
    const result = await reader.readTree(commit.treeSha);
    if (result.sha !== commit.treeSha || result.truncated !== false || !Array.isArray(result.tree) ||
        result.tree.length > CALCULATOR_PROFILE.maxTreeEntries) refuseCalculatorChange();
    const tree = new Map<string, CalculatorTreeEntry>();
    for (const entry of result.tree) {
      if (!entry || !treePath(entry.path) || !shaValid(entry.sha) || tree.has(entry.path) ||
          !["blob", "tree", "commit"].includes(entry.type) || typeof entry.mode !== "string") refuseCalculatorChange();
      tree.set(entry.path, { ...entry });
    }
    const sources = new Map<string, string>();
    const metadata: Array<{ path: string; exists: boolean; blobSha?: string; sourceSha256?: string }> = [];
    for (const path of approved.changePaths) {
      const parts = path.split("/");
      for (let index = 1; index < parts.length; index++) {
        const parent = parts.slice(0, index).join("/");
        const entry = tree.get(parent);
        if ((entry && (entry.type !== "tree" || entry.mode !== "040000")) ||
            (!entry && [...tree.keys()].some(key => key.startsWith(parent + "/")))) refuseCalculatorChange();
      }
      const entry = tree.get(path);
      if (!entry) {
        if ([...tree.keys()].some(key => key.startsWith(path + "/"))) refuseCalculatorChange();
        metadata.push({ path, exists: false });
        continue;
      }
      if (!regular(entry) || (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || entry.size < 0 ||
          entry.size > CALCULATOR_PROFILE.maxSourceBytes))) refuseCalculatorChange();
      const blob = await reader.readBlob(entry.sha);
      if (blob.sha !== entry.sha || blob.encoding !== "base64" || typeof blob.content !== "string" ||
          blob.content.length > CALCULATOR_PROFILE.maxSourceBytes * 2) refuseCalculatorChange();
      const encoded = blob.content.replace(/\r?\n/g, "");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) refuseCalculatorChange();
      const data = Buffer.from(encoded, "base64");
      const source = data.toString("utf8");
      const gitSha = createHash("sha1").update(Buffer.concat([Buffer.from("blob " + data.length + "\0"), data])).digest("hex");
      if (gitSha !== entry.sha || data.length > CALCULATOR_PROFILE.maxSourceBytes ||
          !Buffer.from(source, "utf8").equals(data) || (entry.size !== undefined && entry.size !== data.length) ||
          scanForSecrets(source).length) refuseCalculatorChange();
      sources.set(path, source);
      metadata.push({ path, exists: true, blobSha: entry.sha, sourceSha256: createHash("sha256").update(data).digest("hex") });
    }
    if (await reader.getHead(approved.baseRef) !== approved.baseSha) refuseCalculatorChange();
    const snapshot: CalculatorSnapshot = Object.freeze({ ...approved,
      changePaths: Object.freeze(approved.changePaths), files: Object.freeze(metadata.map(file => Object.freeze(file))) });
    originals.set(snapshot, sources);
    return snapshot;
  } catch { return refuseCalculatorChange(); }
}

/** Host API. Do not serialize this source map into a model tool result. */
export function calculatorSources(snapshot: CalculatorSnapshot): ReadonlyMap<string, string> {
  const sources = originals.get(snapshot);
  if (!sources) return refuseCalculatorChange();
  return new Map(sources);
}
export async function verifyCalculatorBase(snapshot: CalculatorSnapshot, reader: CalculatorSnapshotReader): Promise<void> {
  if (!originals.has(snapshot)) refuseCalculatorChange();
  try { if (await reader.getHead(snapshot.baseRef) !== snapshot.baseSha) refuseCalculatorChange(); }
  catch { refuseCalculatorChange(); }
}

/** Fixed-target read-only adapter. No model keys, fallback endpoint or write API. */
export function createCalculatorSnapshotReader(env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = globalThis.fetch): CalculatorSnapshotReader {
  const repository = CALCULATOR_PROFILE.repository;
  const token = env.GITHUB_TOKEN;
  if (env.AGENT_FACTORY_TARGET_PROFILE !== "calculator" || !token ||
      !env.AGENT_ALLOWED_REPOSITORIES?.split(",").map(value => value.trim()).includes(repository)) refuseCalculatorChange();
  async function read(path: string): Promise<unknown> {
    try {
      const response = await transport("https://api.github.com/repos/" + repository + path, {
        method: "GET", headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok || !response.body) return refuseCalculatorChange();
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1_048_576) { await reader.cancel(); return refuseCalculatorChange(); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return refuseCalculatorChange(); }
  }
  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return refuseCalculatorChange();
    return value as Record<string, unknown>;
  }
  function digest(value: unknown): string { if (!shaValid(value)) return refuseCalculatorChange(); return value; }
  return {
    getHead: async ref => {
      try { validateCalculatorScope({ repository, baseRef: ref, baseSha: "a".repeat(40), changePaths: ["index.html"] }); }
      catch { return refuseCalculatorChange(); }
      return digest(object(await read("/commits/" + encodeURIComponent(ref))).sha);
    },
    readCommit: async sha => {
      const data = object(await read("/git/commits/" + digest(sha)));
      return { sha: digest(data.sha), treeSha: digest(object(data.tree).sha) };
    },
    readTree: async sha => {
      const data = object(await read("/git/trees/" + digest(sha) + "?recursive=1"));
      if (typeof data.truncated !== "boolean" || !Array.isArray(data.tree)) return refuseCalculatorChange();
      return { sha: digest(data.sha), truncated: data.truncated, tree: data.tree as CalculatorTreeEntry[] };
    },
    readBlob: async sha => {
      const data = object(await read("/git/blobs/" + digest(sha)));
      if (typeof data.encoding !== "string" || typeof data.content !== "string") return refuseCalculatorChange();
      return { sha: digest(data.sha), encoding: data.encoding, content: data.content };
    },
  };
}
