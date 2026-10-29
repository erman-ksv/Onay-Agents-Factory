/** Source-free, strictly read-only accounting for the historical published Calculator t02.
 * PINNED OBSERVATIONS are not model usage invoices, nor a license to replay a task.
 * A trusted host must authenticate the original GitHub run/artifact and entire
 * private archive independently before treating these numbers as prior charges.
 * This module does not read a ZIP, create a remote admission, persist a receipt,
 * authorize a model request, publish, or advance the task controller.
 */
import type { CalculatorPriorModelCharge } from "./calculatorModelTeam.js";

export const CALCULATOR_T02_CHARGE_RECONCILIATION_ERROR =
  "Historical Calculator t02 charge reconciliation refused; preserve archive, locks and all costs. No replay or refund.";
export const CALCULATOR_T02_CHARGE_PIN = Object.freeze({
  manifestSha256: "68f3854c9df47e48219e206df977dc0f68d2cfe4cdcfeaaa0b5380fc013ce71c",
  artifactSha256: "6c62eb1a42182975101d5de306cf716249887f98fb117f7bb477ef69810abbb6",
  originalReceiptSha256: "eb920ca04fead67298f7443102ee118c0f9300fc623ef36af1aa42cd00cd375b",
  candidateSha: "949a0bf874722fd8cbd886c2cb0af8f2b502ac05",
  sourceRunId: 39790544926,
  artifactId: 12431481505,
  recorded: Object.freeze({
    attemptedRequests: 12, totalRequestBytes: 110138, reservedRunTokens: 36235, elapsedMs: 513055,
  }),
  conservative: Object.freeze({
    attemptedRequests: 12, totalRequestBytes: 110138, reservedRunTokens: 40564, elapsedMs: 513058,
  }),
  // In order: two truncated calls, the complete-generation review attempt,
  // the qualifying review attempt and the successful historical publication.
  runIds: Object.freeze([39747322491, 39753293947, 39756457942, 39765383540, 39790544926]),
});
type Charge = CalculatorPriorModelCharge;
export type CalculatorT02ChargePhase = Readonly<{
  runId: number; settled: Charge; checkpointHighWater: Charge;
}>;
export type CalculatorT02ChargeObservation = Readonly<{
  manifestSha256: string; candidateSha: string; sourceRunId: number; artifactId: number;
  phases: readonly CalculatorT02ChargePhase[];
  recordedAggregate: Charge;
  finalNewCharge: Charge;
}>;
export type CalculatorT02ReconciledCharge = Readonly<{
  taskId: "calculator-pilot-step7-v1-34ee03-t02";
  manifestSha256: string; candidateSha: string;
  priorCharge: Charge; phaseCount: 5;
  readOnly: true; resumeAuthorized: false; budgetResetAuthorized: false;
  publicationAuthorized: false; autonomousDevelopmentProven: false;
}>;
const KEYS = ["attemptedRequests", "totalRequestBytes", "reservedRunTokens", "elapsedMs"] as const;
const CHARGE_KEYS = [...KEYS].sort().join(",");
const REFUSE = (): never => { throw Error(CALCULATOR_T02_CHARGE_RECONCILIATION_ERROR); };
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return REFUSE();
  const expected = [...keys].sort().join(",");
  const names = Reflect.ownKeys(input);
  if (names.length !== keys.length || names.some(name => typeof name !== "string") ||
      names.slice().sort().join(",") !== expected) return REFUSE();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (keys.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key], "value"))) return REFUSE();
  return Object.fromEntries(keys.map(key => [key, descriptors[key]!.value]));
}
function charge(value: unknown, positive = true): Charge {
  const data = record(value, KEYS);
  if (KEYS.some(key => typeof data[key] !== "number" || !Number.isSafeInteger(data[key]) ||
      (positive ? Number(data[key]) < 1 : Number(data[key]) < 0))) return REFUSE();
  return Object.freeze({
    attemptedRequests: data.attemptedRequests as number, totalRequestBytes: data.totalRequestBytes as number,
    reservedRunTokens: data.reservedRunTokens as number, elapsedMs: data.elapsedMs as number,
  });
}
function equal(a: Charge, b: Charge): boolean { return KEYS.every(key => a[key] === b[key]); }
function sum(phases: readonly Charge[]): Charge {
  const values = Object.fromEntries(KEYS.map(key => [key, phases.reduce((total, p) => total + p[key], 0)]));
  return charge(values, true);
}
/** Each original phase retains its settled cost and its checkpoint high-water.
 * On the final phase the terminal writer can advance elapsed time AFTER the
 * published report. It must not decrease any other component.
 *
 * CAUTION: caller-provided JSON is DATA, not proof of artifact origin or live
 * authority; this function intentionally has no live-state side effects.
 */
export function inspectCalculatorT02ConservativeCharge(input: unknown): CalculatorT02ReconciledCharge {
  try {
    const value = record(input, ["manifestSha256", "candidateSha", "sourceRunId",
      "artifactId", "phases", "recordedAggregate", "finalNewCharge"]);
    const pin = CALCULATOR_T02_CHARGE_PIN;
    if (value.manifestSha256 !== pin.manifestSha256 || value.candidateSha !== pin.candidateSha ||
        value.sourceRunId !== pin.sourceRunId || value.artifactId !== pin.artifactId ||
        !Array.isArray(value.phases) || value.phases.length !== pin.runIds.length) return REFUSE();
    const settled: Charge[] = [], conservative: Charge[] = [];
    for (const [index, raw] of (value.phases as unknown[]).entries()) {
      const phase = record(raw, ["runId", "settled", "checkpointHighWater"]);
      if (phase.runId !== pin.runIds[index]) return REFUSE();
      const s = charge(phase.settled), high = charge(phase.checkpointHighWater);
      if (high.attemptedRequests !== s.attemptedRequests ||
          high.totalRequestBytes !== s.totalRequestBytes) return REFUSE();
      const terminal = index === pin.runIds.length - 1 ? charge(value.finalNewCharge) : s;
      if (index === pin.runIds.length - 1 && (terminal.attemptedRequests !== s.attemptedRequests ||
          terminal.totalRequestBytes !== s.totalRequestBytes ||
          terminal.reservedRunTokens !== s.reservedRunTokens || terminal.elapsedMs < s.elapsedMs)) return REFUSE();
      settled.push(s);
      conservative.push(charge(Object.fromEntries(KEYS.map(key =>
        [key, Math.max(s[key], high[key], terminal[key])]))));
    }
    const recorded = charge(value.recordedAggregate);
    if (!equal(sum(settled), recorded) || !equal(recorded, pin.recorded) ||
        !equal(sum(conservative), pin.conservative) ||
        conservative.some((entry, index) => KEYS.some(key => entry[key] < settled[index]![key]))) return REFUSE();
    return Object.freeze({
      taskId: "calculator-pilot-step7-v1-34ee03-t02" as const,
      manifestSha256: pin.manifestSha256, candidateSha: pin.candidateSha,
      priorCharge: pin.conservative, phaseCount: 5 as const,
      readOnly: true as const, resumeAuthorized: false as const,
      budgetResetAuthorized: false as const, publicationAuthorized: false as const,
      autonomousDevelopmentProven: false as const,
    });
  } catch { return REFUSE(); }
}
