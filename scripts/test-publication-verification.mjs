import assert from "node:assert/strict";
import {
  REQUIRED_PUBLICATION_CHECKS,
  blockingGoldenReserveChecks,
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
const golden = structuredClone(record);
delete golden.selectedForQuiz;
golden.goldenReserve = { approvedAt: "2026-09-07T00:00:00Z" };
golden.checks.fragment.state = "automatic";
golden.checks.relationships.state = "automatic";
assert.equal(lifecycleFor(golden), "golden");
assert.deepEqual(blockingGoldenReserveChecks(golden), []);
assert.deepEqual(blockingPublicationChecks(golden), ["fragment", "relationships"]);
const cover = structuredClone(record);
cover.release = { versionType: "cover" };
assert.deepEqual(blockingPublicationChecks(cover), ["originalRecording"]);
cover.checks.originalRecording = { state: "verified", sources: ["https://example.com/original"] };
assert.deepEqual(blockingPublicationChecks(cover), []);
const loudnessPending = structuredClone(record);
loudnessPending.checks.audioLoudness = { state: "automatic" };
assert.deepEqual(blockingPublicationChecks(loudnessPending), ["audioLoudness"]);
console.log("publication verification tests passed");
