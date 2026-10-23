import test from "node:test";
import assert from "node:assert/strict";
import { CALCULATOR_T02_CHARGE_PIN as PIN, CALCULATOR_T02_CHARGE_RECONCILIATION_ERROR as ERROR,
  inspectCalculatorT02ConservativeCharge as inspect } from "./calculatorT02ChargeReconciliation.js";

const observed = {
  manifestSha256: PIN.manifestSha256, candidateSha: PIN.candidateSha,
  sourceRunId: PIN.sourceRunId, artifactId: PIN.artifactId,
  phases: [
    {runId:39747322491,settled:{attemptedRequests:1,totalRequestBytes:4840,reservedRunTokens:3070,elapsedMs:23206},
      checkpointHighWater:{attemptedRequests:1,totalRequestBytes:4840,reservedRunTokens:3070,elapsedMs:23206}},
    {runId:39753293947,settled:{attemptedRequests:1,totalRequestBytes:5300,reservedRunTokens:3223,elapsedMs:19922},
      checkpointHighWater:{attemptedRequests:1,totalRequestBytes:5300,reservedRunTokens:3223,elapsedMs:19922}},
    {runId:39756457942,settled:{attemptedRequests:4,totalRequestBytes:33403,reservedRunTokens:11835,elapsedMs:201580},
      checkpointHighWater:{attemptedRequests:4,totalRequestBytes:33403,reservedRunTokens:11835,elapsedMs:201580}},
    {runId:39765383540,settled:{attemptedRequests:3,totalRequestBytes:33296,reservedRunTokens:9071,elapsedMs:129638},
      checkpointHighWater:{attemptedRequests:3,totalRequestBytes:33296,reservedRunTokens:11275,elapsedMs:129626}},
    {runId:39790544926,settled:{attemptedRequests:3,totalRequestBytes:33299,reservedRunTokens:9036,elapsedMs:138709},
      checkpointHighWater:{attemptedRequests:3,totalRequestBytes:33299,reservedRunTokens:11161,elapsedMs:138695}},
  ],
  recordedAggregate:{attemptedRequests:12,totalRequestBytes:110138,reservedRunTokens:36235,elapsedMs:513055},
  finalNewCharge:{attemptedRequests:3,totalRequestBytes:33299,reservedRunTokens:9036,elapsedMs:138712},
};
const copy = () => structuredClone(observed);
const refused = (value: unknown) => assert.throws(() => inspect(value), {message: ERROR});
test("historical t02 conservative charge is source-free metadata, not execution authority", () => {
  const before = JSON.stringify(observed), result = inspect(copy());
  assert.deepEqual(result.priorCharge, PIN.conservative);
  assert.equal(result.phaseCount, 5); assert.equal(result.resumeAuthorized, false);
  assert.equal(result.publicationAuthorized, false); assert.equal(result.budgetResetAuthorized, false);
  assert.equal(result.autonomousDevelopmentProven, false);
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.priorCharge));
  assert.equal(JSON.stringify(observed), before);
});
test("pinned origin, exact candidate and phase ordering are mandatory", () => {
  for (const key of ["manifestSha256","candidateSha","sourceRunId","artifactId"] as const) {
    const x = copy(); (x as any)[key] = key.includes("Sha") ? "0".repeat(64) : 1;refused(x);
  }
  const x=copy(); x.phases.reverse();refused(x);
  const y=copy(); y.phases.pop();refused(y);
});
test("cannot refund, double count or undercount the original costs", () => {
  const mutations = [
    (x: ReturnType<typeof copy>) => {x.recordedAggregate.reservedRunTokens=40564;},
    (x: ReturnType<typeof copy>) => {x.recordedAggregate.attemptedRequests=0;},
    (x: ReturnType<typeof copy>) => {x.phases[3]!.checkpointHighWater.reservedRunTokens=9071;},
    (x: ReturnType<typeof copy>) => {x.phases[4]!.checkpointHighWater.reservedRunTokens=9036;},
    (x: ReturnType<typeof copy>) => {x.finalNewCharge.elapsedMs=138709;},
    (x: ReturnType<typeof copy>) => {x.finalNewCharge.elapsedMs=138713;},
    (x: ReturnType<typeof copy>) => {x.phases[0]!.settled.totalRequestBytes=0;},
    (x: ReturnType<typeof copy>) => {x.phases[2]!.checkpointHighWater.attemptedRequests=5;},
  ];
  for (const mutate of mutations){const x=copy();mutate(x);refused(x);}
});
test("malformed or accessor-bearing external JSON cannot become a permit", () => {
  refused(null);refused({});refused({...copy(),resumeAuthorized:true});
  const x=copy();Object.defineProperty(x,"phases",{get(){throw Error("untrusted getter");}});
  refused(x);
  const y=copy();Object.defineProperty(y.phases[0],"settled",{get(){throw Error("untrusted getter");}});refused(y);
});
