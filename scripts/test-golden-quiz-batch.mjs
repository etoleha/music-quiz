import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const files = [26, 27, 28, 29, 30].map((number) => path.join(repoRoot, "data", `quiz-release-draft-${number}.json`));
const releases = files.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
assert.equal(releases.length, 5);
assert.ok(releases.every(({ tracks }) => tracks.length === 20));
const songs = releases.flatMap(({ tracks }) => tracks);
assert.equal(new Set(songs.map(({ songId }) => songId)).size, 100);
assert.equal(new Set(songs.map(({ youtube }) => youtube.videoId)).size, 100);
for (const release of releases) {
  assert.equal(release.status, "draft-preverified");
  assert.deepEqual(release.stats.eras, { "1990s": 4, "2000s": 5, "2010s": 6, "2020s": 5 });
  assert.equal(new Set(release.tracks.flatMap(({ artistIds }) => artistIds)).size, release.tracks.flatMap(({ artistIds }) => artistIds).length);
  assert.equal(release.stats.rapTracks, release.policy.rapTracksSelected);
}
console.log("golden quiz batch tests passed");
