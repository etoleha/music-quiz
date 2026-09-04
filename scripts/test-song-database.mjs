import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";

const dataUrl = new URL("../data/", import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL("song-database.json", dataUrl), "utf8"));
const database = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(index.archive, dataUrl))).toString("utf8"));

assert.equal(database.songs.length, index.stats.songs);
assert.equal(index.stats.poolPositions, 3020);
assert.equal(index.stats.quizTrackPositions, 420);
assert.equal(index.stats.publishedQuizSongs, 420);
assert.ok(index.stats.chartSongs > 9000);
assert.ok(index.stats.quizCandidates > 1000);
assert.ok(index.stats.readyForCuration > 1000);
assert.ok(index.stats.readyForUniqueArtistQuiz > 500);
assert.ok(index.stats.usedArtists > 100);
assert.equal(index.stats.readyForPublication, 100);
assert.equal(index.stats.readyForAutomaticQuiz, 100);

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
  if (song.release.releaseYearStatus === "candidate") {
    assert.ok(song.release.releaseYear !== null);
    assert.ok(song.release.candidateYears.some(({ year }) => year === song.release.releaseYear));
  }
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

const readyPool = JSON.parse(fs.readFileSync(new URL("quiz-ready-songs.json", dataUrl), "utf8"));
assert.equal(readyPool.songs.length, 100);
assert.deepEqual(readyPool.stats.eraCounts, { soviet: 10, "1990s": 16, "2000s": 39, "2010s": 25, "2020s": 10 });
assert.equal(new Set(readyPool.songs.map(({ songId }) => songId)).size, 100);
assert.equal(new Set(readyPool.songs.map(({ youtube }) => youtube.videoId)).size, 100);
const readyArtistIds = new Set();
for (const prepared of readyPool.songs) {
  assert.equal(prepared.readyForQuiz, true);
  assert.match(prepared.youtube.videoId, /^[A-Za-z0-9_-]{11}$/);
  assert.ok(prepared.youtube.durationSeconds >= 90 && prepared.youtube.durationSeconds <= 480);
  assert.ok(prepared.clip.duration >= 5 && prepared.clip.duration <= 20);
  assert.ok(prepared.clip.start >= 0 && prepared.clip.start + prepared.clip.duration <= prepared.youtube.durationSeconds);
  for (const artistId of prepared.artistIds) {
    assert.equal(readyArtistIds.has(artistId), false, `artist repeated in ready pool: ${prepared.artist}`);
    readyArtistIds.add(artistId);
  }
  const databaseSong = database.songs.find(({ id }) => id === prepared.songId);
  assert.equal(databaseSong?.readyForAutomaticQuiz, true, `database song is not ready: ${prepared.artist} — ${prepared.title}`);
}

console.log("song database tests passed");
