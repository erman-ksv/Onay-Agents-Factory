/** Host-owned, bounded source selection for a mobile-only Onay team assignment.
 * The model cannot add paths, select repositories, or widen the published diff.
 */
export const ONAY_MOBILE_ORDER_CONTEXT = [
  "package.json",
  "mobile/tezjet-app/package.json",
  "mobile/tezjet-app/lib/orders.ts",
  "mobile/tezjet-app/test/orders.test.mjs",
] as const;

export const ONAY_MOBILE_ORDER_CHANGES = [
  "mobile/tezjet-app/lib/orders.ts",
  "mobile/tezjet-app/test/orders.test.mjs",
] as const;

const MOBILE_SCOPE = new Set<string>(ONAY_MOBILE_ORDER_CONTEXT);

export function assertOnayMobileExplorerFiles(input: readonly string[]): readonly string[] {
  if (!Array.isArray(input) || input.length !== MOBILE_SCOPE.size ||
      new Set(input).size !== input.length ||
      input.some(path => !MOBILE_SCOPE.has(path))) {
    throw new Error("Onay mobile task accepts exactly the approved immutable source paths.");
  }
  return [...input];
}

export const ONAY_MOBILE_REQUIRED_CI = {
  names: ["verify-mobile"],
  steps: ["Typecheck", "Offer lifecycle and API error regressions",
    "Export Android and iOS bundles", "Assemble Android debug APK", "Upload Android debug APK"],
} as const;
