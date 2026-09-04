import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";

const dataUrl = new URL("../data/", import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL("song-database.json", dataUrl), "utf8"));
const database = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(index.archive, dataUrl))).toString("utf8"));

assert.equal(database.songs.length, index.stats.songs);
assert.equal(index.stats.poolPositions, 3000);
assert.equal(index.stats.quizTrackPositions, 420);
assert.equal(index.stats.publishedQuizSongs, 420);
assert.ok(index.stats.chartSongs > 9000);
assert.ok(index.stats.quizCandidates > 1000);
assert.ok(index.stats.readyForCuration > 1000);
assert.ok(index.stats.readyForUniqueArtistQuiz > 500);
assert.ok(index.stats.usedArtists > 100);
assert.equal(index.stats.readyForAutomaticQuiz, 0, "a song without a checked clip and release year is not publication-ready");

const hiFi = database.songs.find(({ artistAliases, titleAliases }) =>
  artistAliases.includes("Hi-Fi") && titleAliases.includes("Беспризорник"));
assert.ok(hiFi, "corrected Hi-Fi track must exist");
assert.equal(database.songs.some(({ artist, title }) => artist === "Hi" && title.startsWith("Fi - ")), false);

for (const song of database.songs) {
  assert.ok(["waiting", "used", "rejected"].includes(song.status.workflow));
  assert.ok(["russian", "foreign", "mixed", "unknown"].includes(song.status.language));
  assert.ok(["verified", "needs-review"].includes(song.status.review));
  assert.ok(["good", "bad", "not-checked"].includes(song.status.fragment));
  assert.ok(Array.isArray(song.artistIds) && song.artistIds.length > 0);
  assert.equal(song.artistIds.length, new Set(song.artistIds).size);
  assert.ok(song.usedArtistIds.every((artistId) => song.artistIds.includes(artistId)));
  if (song.readyForUniqueArtistQuiz) assert.equal(song.usedArtistIds.length, 0);
  assert.ok(["verified", "candidate", "missing"].includes(song.release.releaseYearStatus));
  if (song.release.releaseYearStatus === "verified") assert.ok(song.release.releaseYear !== null);
  if (song.release.releaseYearStatus === "candidate") assert.equal(song.release.candidateYears.length, 1);
  if (song.release.releaseYear !== null) assert.ok(song.release.releaseYear >= 1900 && song.release.releaseYear <= 2100);
  if (song.release.versionYear !== null) assert.ok(song.release.versionYear >= 1900 && song.release.versionYear <= 2100);
  for (const candidate of song.release.candidateYears) assert.ok(candidate.year >= 1900 && candidate.year <= 2100);
  for (const values of Object.values(song.externalIds)) assert.equal(values.length, new Set(values).size);
}

const quizCandidates = JSON.parse(fs.readFileSync(new URL("quiz-candidates.json", dataUrl), "utf8"));
const reserved = new Set();
for (const song of quizCandidates.candidates) {
  assert.ok(song.artistIds.every((artistId) => !reserved.has(artistId)), `artist repeated in candidate queue: ${song.artist}`);
  for (const artistId of song.artistIds) reserved.add(artistId);
}

console.log("song database tests passed");
