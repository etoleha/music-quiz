import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { artistsOverlap, buildAliasIndex, normalizeObservation } from "./chart-normalization.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const pool = readJson(dataPath("song-pool-4.json"));
const report = readJson(dataPath("quiz-answer-import-report.json"));
const aliases = buildAliasIndex(readJson(dataPath("artist-aliases.json")));
const index = readJson(dataPath("song-database.json"));
const compressed = index.archiveParts?.length
  ? Buffer.concat(index.archiveParts.map((file) => fs.readFileSync(dataPath(file))))
  : fs.readFileSync(dataPath(index.archive));
assert.equal(crypto.createHash("sha256").update(compressed).digest("hex"), index.archiveSha256);
const database = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));

assert.equal(pool.count, pool.tracks.length);
assert.equal(report.stats.outputTracks, pool.tracks.length);
assert.ok(pool.tracks.length >= 5_900, "too few quiz-answer tracks survived deduplication");
const keys = new Set();
for (const track of pool.tracks) {
  assert.ok(track.artist && track.title);
  assert.ok(["recognizable", "middle", "deep"].includes(track.sourceBand));
  assert.ok(["russian", "foreign", "mixed", "unknown"].includes(track.language));
  assert.ok(["verified", "needs-review"].includes(track.reviewStatus));
  assert.ok(track.quizAnswerRefs?.length);
  const normalized = normalizeObservation(track, aliases);
  const key = `${[...normalized.artist.participants].sort().join("+")}:${normalized.titleKey}`;
  assert.ok(!keys.has(key), `duplicate pool pair ${track.artist} — ${track.title}`);
  keys.add(key);
  if (track.candidateType === "artist-seed-yandex") {
    assert.ok(track.yandexTrackId);
    assert.ok(track.sourceUrl?.includes("yandex"));
    if (track.popularity?.monthRank && track.popularity.monthRank <= 20_000) {
      assert.ok(track.popularity.selectedRank > 3, `popular artist used a top-3 song: ${track.artist} — ${track.title}`);
    }
  }
}

const databaseByPoolRef = new Map();
for (const song of database.songs) {
  for (const reference of song.poolRefs || []) {
    if (reference.file === "song-pool-4.json") databaseByPoolRef.set(reference.id, song);
  }
}
for (const track of pool.tracks) {
  const song = databaseByPoolRef.get(track.id);
  assert.ok(song, `database is missing ${track.id}`);
  const hasIndependentSource = Boolean(song.chart || song.quizRefs?.length
    || song.poolRefs?.some(({ file }) => file !== "song-pool-4.json"));
  const normalizedTrack = normalizeObservation(track, aliases);
  const sameIndependentSong = hasIndependentSource && [song.artist, ...(song.artistAliases || [])]
    .map((artist) => normalizeObservation({ artist, title: track.title }, aliases).artist)
    .some((artist) => artistsOverlap(artist, normalizedTrack.artist));
  assert.equal(sameIndependentSong, false, `pool contains an already-known pair: ${track.artist} — ${track.title}`);
}

const pairTracks = pool.tracks.filter(({ candidateType }) => candidateType === "quiz-answer-pair");
const enrichedPairs = pairTracks.filter(({ yandexTrackId }) => yandexTrackId);
assert.ok(enrichedPairs.length >= pairTracks.length * 0.45, "pair metadata coverage is unexpectedly low");
console.log(JSON.stringify({ tracks: pool.tracks.length, pairs: pairTracks.length, enrichedPairs: enrichedPairs.length }, null, 2));
