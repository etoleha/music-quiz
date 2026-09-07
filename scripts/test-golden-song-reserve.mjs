import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { goldenReserveReport, validatePublicationVerification } from "./publication-verification.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const reserve = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "song-golden-reserve.json"), "utf8"));
const verification = validatePublicationVerification(JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "song-publication-verification.json"), "utf8")));
assert.equal(reserve.songs.length, 200);
assert.equal(new Set(reserve.songs.map(({ songId }) => songId)).size, 200);
assert.equal(new Set(reserve.songs.map(({ youtube }) => youtube.videoId)).size, 200);
assert.equal(new Set(reserve.songs.flatMap(({ artistIds }) => artistIds)).size, reserve.songs.flatMap(({ artistIds }) => artistIds).length);
assert.deepEqual(reserve.stats.eras, { "1990s": 30, "2000s": 50, "2010s": 60, "2020s": 60 });
assert.deepEqual(reserve.stats.difficulty, { recognizable: 50, middle: 80, deep: 70 });
assert.equal(reserve.stats.popularArtistTop3Songs, 0);
assert.equal(reserve.stats.withVerifiedAlbum, 200);
assert.equal(reserve.stats.withArtistImage, 200);
for (const song of reserve.songs) {
  const report = goldenReserveReport(song, verification.songs[song.songId]);
  assert.equal(report.passed, true, `${song.songId}: ${report.blockers.join(", ")}`);
  assert.equal(report.lifecycle, "golden");
  assert.equal(song.goldenVerification.status, "passed");
  assert.equal(song.optionalMetadata.releaseYearStatus, "verified");
}
console.log("golden reserve tests passed");
