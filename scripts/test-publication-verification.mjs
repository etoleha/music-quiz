import assert from "node:assert/strict";
import {
  REQUIRED_PUBLICATION_CHECKS,
  blockingGoldenReserveChecks,
  blockingPublicationChecks,
  conflictEntityIdsFor,
  lifecycleFor,
  publicationReport,
  sealPublicationVerification,
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
const song = {
  songId: "test",
  artist: "Группа",
  title: "Песня",
  artistAliases: ["Группа"],
  titleAliases: ["Песня"],
  artistIds: ["group"],
  approximateYear: 2001,
  recognizability: "middle",
  youtube: { videoId: "abcdefghijk" },
  clip: { start: 30, duration: 11 },
  optionalMetadata: { artistForm: "Группа", album: { title: "Альбом", year: 2001 } },
};
const sealed = sealPublicationVerification(song, record, "2026-09-07T12:00:00Z");
validatePublicationVerification({ version: 2, songs: { test: sealed } });
assert.equal(publicationReport(song, sealed).passed, true);
const changedForm = structuredClone(song);
changedForm.optionalMetadata.artistForm = "Исполнитель";
assert.deepEqual(publicationReport(changedForm, sealed).blockers, ["fullReverification"]);
const changedAlbum = structuredClone(song);
changedAlbum.optionalMetadata.album.title = "Другой альбом";
assert.deepEqual(publicationReport(changedAlbum, sealed).blockers, ["fullReverification"]);
const changedVideo = structuredClone(song);
changedVideo.youtube.videoId = "lmnopqrstuv";
assert.deepEqual(publicationReport(changedVideo, sealed).blockers, ["fullReverification"]);
console.log("publication verification tests passed");
