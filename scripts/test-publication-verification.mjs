import assert from "node:assert/strict";
import {
  REQUIRED_PUBLICATION_CHECKS,
  blockingPublicationChecks,
  conflictEntityIdsFor,
  lifecycleFor,
  validatePublicationVerification,
} from "./publication-verification.mjs";

const verifiedChecks = Object.fromEntries(REQUIRED_PUBLICATION_CHECKS.map((name) => [name, { state: name === "soundtrack" ? "not-applicable" : "verified" }]));
const record = { selectedForQuiz: "new-rules-test-01", checks: verifiedChecks, relationships: { conflictEntityIds: ["bravo", "zhannaaguzarova"] } };
validatePublicationVerification({ version: 1, songs: { test: record } });
assert.equal(lifecycleFor(record), "verified");
assert.deepEqual(blockingPublicationChecks(record), []);
assert.deepEqual(conflictEntityIdsFor({ songId: "test", artistIds: ["bravo"] }, { songs: { test: record } }), ["bravo", "zhannaaguzarova"]);
const incomplete = structuredClone(record);
incomplete.checks.fragment.state = "automatic";
assert.equal(lifecycleFor(incomplete), "selected");
assert.deepEqual(blockingPublicationChecks(incomplete), ["fragment"]);
assert.equal(lifecycleFor({ ...record, publishedAt: "2026-09-07T00:00:00Z" }), "published");
console.log("publication verification tests passed");
