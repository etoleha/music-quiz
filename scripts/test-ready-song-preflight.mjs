import assert from "node:assert/strict";
import { validateReadySong } from "./ready-song-preflight.mjs";

const valid = {
  readyForQuiz: true,
  eligibility: { approved: true },
  artistIds: ["artist"],
  era: "2000s",
  approximateYear: 2005,
  recognizability: "middle",
  youtube: { videoId: "abcdefghijk", title: "Исполнитель — Песня", durationSeconds: 200 },
  clip: { start: 30, duration: 11, review: "automatic" },
  optionalMetadata: { artistForm: "Исполнитель", releaseYearStatus: "candidate", album: { year: 2006 } },
};
assert.deepEqual(validateReadySong(valid).blockers, []);
assert.ok(validateReadySong(valid).warnings.some(({ code }) => code === "year-approximate"));

const reissue = structuredClone(valid);
reissue.optionalMetadata.album.year = 2024;
assert.ok(validateReadySong(reissue).blockers.some(({ code }) => code === "album-year-mismatch"));

const missingForm = structuredClone(valid);
missingForm.optionalMetadata.artistForm = null;
assert.ok(validateReadySong(missingForm).blockers.some(({ code }) => code === "artist-form-missing"));

const badClip = structuredClone(valid);
badClip.clip.start = 195;
assert.ok(validateReadySong(badClip).blockers.some(({ code }) => code === "clip-out-of-bounds"));

const wrongEra = structuredClone(valid);
wrongEra.approximateYear = 1999;
assert.ok(validateReadySong(wrongEra).blockers.some(({ code }) => code === "era-year-mismatch"));

console.log("ready song preflight tests passed");
