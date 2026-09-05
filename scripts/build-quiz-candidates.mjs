import fs from "node:fs";
import path from "node:path";
import { isArtistBlocked, isArtistPrioritized, loadArtistSelectionPolicy } from "./artist-selection-policy.mjs";
import zlib from "node:zlib";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const databaseIndex = JSON.parse(fs.readFileSync(dataPath("song-database.json"), "utf8"));
const database = JSON.parse(zlib.gunzipSync(fs.readFileSync(dataPath(databaseIndex.archive))).toString("utf8"));
const policy = JSON.parse(fs.readFileSync(dataPath("quiz-generation-policy.json"), "utf8"));
const artistSelectionPolicy = loadArtistSelectionPolicy(repoRoot);
const limit = Math.max(1, Number(process.env.QUIZ_CANDIDATE_LIMIT || 500));

const reservedArtists = new Set();
const candidates = [];
const orderedSongs = database.songs
  .filter((song) => !isArtistBlocked(song, artistSelectionPolicy))
  .sort((left, right) => Number(isArtistPrioritized(right, artistSelectionPolicy))
    - Number(isArtistPrioritized(left, artistSelectionPolicy)));
for (const song of orderedSongs) {
  if (!song.readyForUniqueArtistQuiz) continue;
  if (song.artistIds.some((artistId) => reservedArtists.has(artistId))) continue;
  for (const artistId of song.artistIds) reservedArtists.add(artistId);
  candidates.push({
    rank: candidates.length + 1,
    id: song.id,
    artist: song.artist,
    title: song.title,
    artistIds: song.artistIds,
    candidateScore: song.candidateScore,
    language: song.status.language,
    releaseYear: song.release.releaseYear,
    candidateYears: song.release.candidateYears,
    sourceIds: song.chart?.sourceIds || [],
    externalIds: song.externalIds,
    blockers: song.publicationBlockers || [],
    publicationProgress: song.publicationProgress,
  });
  if (candidates.length >= limit) break;
}

const report = {
  version: 1,
  generatedAt: database.generatedAt,
  policy,
  stats: {
    totalSongs: database.stats.songs,
    readyForCuration: database.stats.readyForCuration,
    uniqueArtistCandidates: database.stats.readyForUniqueArtistQuiz,
    selectedWithoutArtistRepeats: candidates.length,
    reservedArtistEntities: reservedArtists.size,
    readyForPublication: database.stats.readyForPublication,
  },
  candidates,
};

fs.writeFileSync(dataPath("quiz-candidates.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.stats, null, 2));
