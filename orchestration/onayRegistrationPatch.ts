/** Real Onay application workflow: fail closed until the owner explicitly opts in. */
export const ONAY_REPOSITORY = "erman-ksv/Onay";
export const ONAY_TARGET_BRANCH = "feat/onay-agent-registration-proof-20261016";
export const ONAY_UI_PATH = "mobile/tezjet-app/app/index.tsx";
export const ONAY_HELPER_PATH = "mobile/tezjet-app/lib/registration.ts";
export const ONAY_TEST_PATH = "mobile/tezjet-app/test/registration.test.mjs";
export const ONAY_ALLOWED_CHANGE_PATHS = [ONAY_UI_PATH, ONAY_HELPER_PATH, ONAY_TEST_PATH] as const;
export const PRIVATE_SOURCE_CONSENT = "I_APPROVE_ONAY_REGISTRATION_SOURCE_TO_GEMINI";

export type ScopedEdit = { find: string; replace: string };
export type ScopedPlan = {
  edits: ScopedEdit[];
  newFiles: { path: string; content: string; message: string }[];
};

export function assertPrivateSourceConsent(value: string | undefined): void {
  if (value !== PRIVATE_SOURCE_CONSENT) {
    throw new Error("BLOCKED: separate explicit consent is required before any private Onay source reaches Gemini.");
  }
}

/** Apply only small, uniquely-anchored substitutions to the original immutable-commit UI source. */
export function applyUiEdits(source: string, edits: ScopedEdit[]): string {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 12) {
    throw new Error("Coder must provide 1-12 narrowly scoped UI edits.");
  }
  let result = source;
  let totalDelta = 0;
  for (const edit of edits) {
    if (typeof edit?.find !== "string" || typeof edit?.replace !== "string" ||
      !edit.find.trim() || edit.find === edit.replace ||
      edit.find.length > 1800 || edit.replace.length > 2600) {
      throw new Error("Coder returned an invalid or overly broad UI edit.");
    }
    const first = result.indexOf(edit.find);
    if (first < 0 || result.indexOf(edit.find, first + edit.find.length) >= 0) {
      throw new Error("UI edit anchor is missing or ambiguous; refusing to guess.");
    }
    result = result.slice(0, first) + edit.replace + result.slice(first + edit.find.length);
    totalDelta += Math.abs(edit.replace.length - edit.find.length);
  }
  if (totalDelta > 6000) throw new Error("UI patch exceeded the narrow task change budget.");
  return result;
}

export function validateScopedPlan(plan: ScopedPlan): void {
  if (!plan || !Array.isArray(plan.newFiles) || plan.newFiles.length !== 2) {
    throw new Error("Coder must create exactly the registration helper and its tests.");
  }
  const paths = plan.newFiles.map(file => file.path);
  if (new Set(paths).size !== 2 || !paths.includes(ONAY_HELPER_PATH) || !paths.includes(ONAY_TEST_PATH)) {
    throw new Error("Coder attempted an unauthorized file path.");
  }
  if (plan.newFiles.some(file => !file.content?.trim() || !file.message?.trim())) {
    throw new Error("Coder returned an empty change file.");
  }
  if (!plan.newFiles.find(file => file.path === ONAY_TEST_PATH)?.content.includes("registrationFullName")) {
    throw new Error("Registration tests must exercise the name normalization helper.");
  }
  const helper = plan.newFiles.find(file => file.path === ONAY_HELPER_PATH)!.content;
  if (!helper.includes("registrationFullName") || !helper.includes("120")) {
    throw new Error("Registration helper must preserve the full_name contract and its length limit.");
  }
}

/**
 * Host-side whitelist: model-selected anchors must be within four registration
 * regions of the pinned app screen (imports, auth state, login, auth form).
 * Other booking, driver, and route flows are never editable by this task.
 */
export function assertRegistrationUiEditScope(source: string, edits: ScopedEdit[]): void {
  const between = (begin: string, end: string) => {
    const start = source.indexOf(begin);
    const stop = source.indexOf(end, start + begin.length);
    if (start < 0 || stop < 0) throw new Error("Expected registration boundary is missing.");
    return { start, end: stop };
  };
  const imports = between('import AsyncStorage', 'function Button(');
  const state = between('export default function Home()', '  const [stops,');
  const login = between('  async function login(', '  async function switchMode(');
  const form = between('    {sessionLoading ? ', '      {profileError ?');
  const permitted = [imports, state, login, form];

  for (const edit of edits) {
    const index = source.indexOf(edit.find);
    if (index < 0 || !permitted.some(region =>
      index >= region.start && index + edit.find.length <= region.end)) {
      throw new Error("Coder tried to edit outside registration-only UI regions.");
    }
  }
}

export function assertRegistrationResult(ui: string, helper: string, tests: string): void {
  for (const check of [
    /registrationFullName\s*\(/, /registration-given-name/,
    /registration-family-name/, /registering/, /auth-signin-mode/,
    /auth-signup-mode/, /full_name/,
  ]) {
    if (!check.test(ui)) throw new Error("UI lacks required registration or returning-user behavior: " + check.source);
  }
  if (!/export\s+function\s+registrationFullName\s*\(/.test(helper) ||
      !/120/.test(helper) || !/return\s+null/.test(helper)) {
    throw new Error("Name helper must validate both fields against 120-character API limit.");
  }
  if (!/registrationFullName/.test(tests) || !/node:test/.test(tests)) {
    throw new Error("Registration helper must have executable node:test regression coverage.");
  }
}
