import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const databaseIndex = JSON.parse(fs.readFileSync(dataPath("song-database.json"), "utf8"));
const database = JSON.parse(zlib.gunzipSync(fs.readFileSync(dataPath(databaseIndex.archive))).toString("utf8"));
const policy = JSON.parse(fs.readFileSync(dataPath("quiz-generation-policy.json"), "utf8"));
const limit = Math.max(1, Number(process.env.QUIZ_CANDIDATE_LIMIT || 500));

const reservedArtists = new Set();
const candidates = [];
for (const song of database.songs) {
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
    blockers: [
      ...(song.release.releaseYearStatus !== "verified" ? ["release-year"] : []),
      ...(!song.externalIds.youtube?.length ? ["youtube-fragment"] : []),
      ...(song.enrichment.review !== "verified" ? ["enrichment-review"] : []),
    ],
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
