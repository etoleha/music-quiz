import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";

const dataUrl = new URL("../data/", import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL("song-database.json", dataUrl), "utf8"));
const database = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(index.archive, dataUrl))).toString("utf8"));

assert.equal(database.songs.length, index.stats.songs);
assert.equal(index.stats.poolPositions, database.songs.reduce((sum, song) => sum + song.poolRefs.length, 0));
assert.equal(index.stats.quizTrackPositions, database.songs.reduce((sum, song) => sum + song.quizRefs.length, 0));
assert.equal(index.stats.publishedQuizSongs, database.songs.filter((song) => song.quizRefs.length).length);
assert.ok(index.stats.chartSongs > 9000);
assert.ok(index.stats.quizCandidates > 1000);
assert.ok(index.stats.readyForCuration > 1000);
assert.ok(index.stats.readyForUniqueArtistQuiz > 500);
assert.ok(index.stats.usedArtists > 100);

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
assert.ok(readyPool.songs.length >= 1000);
assert.equal(readyPool.songs.length, readyPool.policy.targetTotal);
assert.equal(Object.values(readyPool.stats.eraCounts).reduce((sum, count) => sum + count, 0), readyPool.songs.length);
assert.equal(new Set(readyPool.songs.map(({ songId }) => songId)).size, readyPool.songs.length);
assert.equal(new Set(readyPool.songs.map(({ youtube }) => youtube.videoId)).size, readyPool.songs.length);
assert.equal(readyPool.stats.newArtistSongs + readyPool.stats.previousArtistOverflowSongs, readyPool.songs.length);
assert.ok(index.stats.readyForPublication >= readyPool.stats.newArtistSongs);
assert.ok(index.stats.readyForAutomaticQuiz >= readyPool.stats.newArtistSongs);
const readyArtistCounts = new Map();
for (const prepared of readyPool.songs) {
  assert.equal(prepared.readyForQuiz, true);
  assert.ok(["new-artist", "previously-used-artist"].includes(prepared.artistNovelty));
  assert.match(prepared.youtube.videoId, /^[A-Za-z0-9_-]{11}$/);
  assert.ok(prepared.youtube.durationSeconds >= 90 && prepared.youtube.durationSeconds <= 480);
  assert.ok(prepared.clip.duration >= 5 && prepared.clip.duration <= 20);
  assert.ok(prepared.clip.start >= 0 && prepared.clip.start + prepared.clip.duration <= prepared.youtube.durationSeconds);
  for (const artistId of prepared.artistIds) {
    const count = (readyArtistCounts.get(artistId) || 0) + 1;
    readyArtistCounts.set(artistId, count);
    assert.ok(count <= readyPool.policy.maxSongsPerArtistInInventory, `artist over inventory limit: ${prepared.artist}`);
  }
  const databaseSong = database.songs.find(({ id }) => id === prepared.songId);
  assert.ok(databaseSong, `database song is missing: ${prepared.artist} — ${prepared.title}`);
  assert.equal(databaseSong.status.workflow, "waiting", `published song leaked into ready inventory: ${prepared.artist} — ${prepared.title}`);
  if (prepared.artistNovelty === "new-artist") {
    assert.equal(databaseSong.readyForAutomaticQuiz, true, `new-artist song is not ready: ${prepared.artist} — ${prepared.title}`);
  }
}

console.log("song database tests passed");
