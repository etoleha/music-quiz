import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fingerprint } from "./chart-normalization.mjs";
import { rankYouTubeResults, searchYouTubeVideos } from "./youtube-search.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const generatedAt = process.env.READY_POOL_GENERATED_AT || new Date().toISOString();
const targetTotal = Math.max(1, Number(process.env.READY_POOL_LIMIT || 100));
const maxNetworkSearches = Math.max(targetTotal, Number(process.env.READY_POOL_MAX_SEARCHES || 180));
const offline = process.argv.includes("--offline");

// The current no-repeat catalog has sixteen reliable 1990s artist entities.
// The four remaining slots stay in the main 2000s peak instead of weakening
// the identity checks just to satisfy a round decade quota.
const defaultTargets = { soviet: 10, "1990s": 16, "2000s": 39, "2010s": 25, "2020s": 10 };
const scaledTargets = Object.fromEntries(Object.entries(defaultTargets).map(([era, count]) => [era, Math.floor(count * targetTotal / 100)]));
for (const era of Object.keys(scaledTargets)) {
  if (Object.values(scaledTargets).reduce((sum, count) => sum + count, 0) >= targetTotal) break;
  scaledTargets[era] += 1;
}

const databaseIndex = readJson(dataPath("song-database.json"));
const compressed = databaseIndex.archiveParts?.length
  ? Buffer.concat(databaseIndex.archiveParts.map((file) => fs.readFileSync(dataPath(file))))
  : fs.readFileSync(dataPath(databaseIndex.archive));
if (databaseIndex.archiveSha256 && crypto.createHash("sha256").update(compressed).digest("hex") !== databaseIndex.archiveSha256) {
  throw new Error("Song database archive checksum mismatch");
}
const database = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
const usedArtistIds = new Set(database.songs.filter((song) => song.quizRefs?.length).flatMap((song) => song.artistIds));
const artistIdOverlaps = (artistId, collection) => [...collection].some((other) =>
  artistId === other || (Math.min(artistId.length, other.length) >= 5 && (artistId.includes(other) || other.includes(artistId))));
const anyArtistOverlaps = (artistIds, collection) => artistIds.some((artistId) => artistIdOverlaps(artistId, collection));
const songsByPoolId = new Map();
for (const song of database.songs) {
  for (const reference of song.poolRefs || []) songsByPoolId.set(reference.id, song);
}

const poolFiles = fs.readdirSync(dataPath()).filter((file) => /^song-pool(?:-(?:\d+|soviet))?\.json$/.test(file)).sort();
const poolTracks = poolFiles.flatMap((file) => readJson(dataPath(file)).tracks.map((track) => ({ ...track, poolFile: file })));
const cachePath = dataPath("youtube-search-cache.json");
const loadedCache = fs.existsSync(cachePath) ? readJson(cachePath) : null;
const cache = loadedCache?.version === 2 ? loadedCache : { version: 2, queries: {} };
cache.queries ||= {};

const saveCache = () => {
  cache.updatedAt = new Date().toISOString();
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
};

const eraFor = (track) => {
  if (track.poolFile === "song-pool-soviet.json") return "soviet";
  if (!Number.isInteger(track.listYear)) return null;
  const decade = Math.floor(track.listYear / 10) * 10;
  return `${decade}s`;
};

const recognitionFor = (track) => {
  if (["recognizable", "award-winner"].includes(track.sourceBand)) return "recognizable";
  if (track.sourceBand === "deep") return "deep";
  return "middle";
};

const durationFor = (recognition) => ({ recognizable: 7, middle: 11, deep: 15 }[recognition] || 11);

const clipStartFor = (videoDuration, clipDuration, key) => {
  const hash = Number.parseInt(crypto.createHash("sha256").update(key).digest("hex").slice(0, 4), 16);
  const offset = hash % 15 - 7;
  const preferred = Math.round(videoDuration * 0.18) + offset;
  return Math.max(20, Math.min(preferred, videoDuration - clipDuration - 20));
};

const bandOrder = ["middle", "recognizable", "middle", "deep"];
const orderCandidates = (tracks) => {
  const groups = new Map(["recognizable", "middle", "deep"].map((band) => [band, []]));
  for (const track of tracks) groups.get(recognitionFor(track)).push(track);
  for (const group of groups.values()) group.sort((left, right) =>
    Number(left.listRank ?? 999) - Number(right.listRank ?? 999)
    || String(left.artist).localeCompare(String(right.artist), "ru"));
  const result = [];
  while ([...groups.values()].some((group) => group.length)) {
    for (const band of bandOrder) {
      const candidate = groups.get(band).shift();
      if (candidate) result.push(candidate);
    }
  }
  return result;
};

const sourceEvidenceFor = (track) => {
  if (track.poolFile === "song-pool-soviet.json") return "trusted-soviet-collection";
  if (/Золотой граммофон/iu.test(track.sourceName || "")) return "golden-gramophone";
  return "trusted-russian-collection";
};

const knownBadPoolIds = new Set(["pool-0029", "pool-0197", "pool-0356", "pool-0431", "pool-0432", "pool-1302", "pool-0478"]);
const suspiciousMetadata = (track, song) => knownBadPoolIds.has(track.id)
  || /клип[_\s-]*\d|\bcover\b|\bremix\b|караоке|минусовк/iu.test(`${track.artist} ${track.title}`)
  || (/\bvs\.?\b/iu.test(track.artist) && song?.artistIds?.length === 1);

const candidateQueues = {};
for (const era of Object.keys(scaledTargets)) {
  candidateQueues[era] = orderCandidates(poolTracks.filter((track) => {
    const song = songsByPoolId.get(track.id);
    if (eraFor(track) !== era || suspiciousMetadata(track, song)) return false;
    return song?.readyForCuration && song.allArtistsUnused && !anyArtistOverlaps(song.artistIds, usedArtistIds);
  }));
}

const selected = [];
const skipped = [];
const reservedArtists = new Set();
let networkSearches = 0;
const searchConcurrency = Math.max(1, Number(process.env.READY_POOL_CONCURRENCY || 6));

const findVideo = async (track) => {
  const query = `${track.artist} ${track.title}`.replace(/\s+/g, " ").trim();
  let cached = cache.queries[query];
  if (!cached && !offline && networkSearches < maxNetworkSearches) {
    networkSearches += 1;
    try {
      const search = await searchYouTubeVideos(track);
      cached = { fetchedAt: new Date().toISOString(), results: search.results.slice(0, 10) };
      cache.queries[query] = cached;
      saveCache();
    } catch (error) {
      skipped.push({ id: track.id, artist: track.artist, title: track.title, reason: String(error?.message || error) });
      return null;
    }
  }
  const ranked = cached?.results ? rankYouTubeResults(track, cached.results) : [];
  if (!ranked[0]) {
    skipped.push({ id: track.id, artist: track.artist, title: track.title, reason: offline ? "not-in-cache" : "no-confident-video-match" });
    return null;
  }
  return ranked[0];
};

for (const [era, target] of Object.entries(scaledTargets)) {
  let cursor = 0;
  while (selected.filter((song) => song.era === era).length < target && cursor < candidateQueues[era].length) {
    const batch = [];
    while (batch.length < searchConcurrency && cursor < candidateQueues[era].length) {
      const track = candidateQueues[era][cursor++];
      const song = songsByPoolId.get(track.id);
      if (!song || anyArtistOverlaps(song.artistIds, reservedArtists)) continue;
      batch.push({ track, song });
    }
    const videos = await Promise.all(batch.map(({ track }) => findVideo(track)));
    for (let index = 0; index < batch.length; index += 1) {
      if (selected.filter((song) => song.era === era).length >= target) break;
      const { track, song } = batch[index];
      const video = videos[index];
      if (!video || anyArtistOverlaps(song.artistIds, reservedArtists)) continue;
      const recognition = recognitionFor(track);
      const clipDuration = durationFor(recognition);
      const approximateYear = Number(track.listYear);
      const result = {
      id: `ready-${String(selected.length + 1).padStart(4, "0")}`,
      songId: song.id,
      poolId: track.id,
      artist: song.artist,
      title: song.title,
      artistIds: song.artistIds,
      artistAliases: song.artistAliases,
      titleAliases: song.titleAliases,
      era,
      approximateYear,
      recognizability: recognition,
      eligibility: {
        approved: true,
        evidence: sourceEvidenceFor(track),
        sourceName: track.sourceName || (track.poolFile === "song-pool-soviet.json" ? "Советская эстрада / Песня года" : "Lezza TV — русская подборка"),
        sourceUrl: track.sourceUrl,
      },
      youtube: {
        videoId: video.videoId,
        title: video.title,
        channel: video.channel,
        viewCount: video.viewCount,
        durationSeconds: video.durationSeconds,
        selectedBy: "automatic-search",
      },
      clip: {
        start: clipStartFor(video.durationSeconds, clipDuration, `${song.id}:${video.videoId}`),
        duration: clipDuration,
        selectedBy: "automatic-verse-biased-heuristic",
        review: "automatic",
      },
      optionalMetadata: {
        album: song.release.album || null,
        artistImage: song.enrichment.artistImage || null,
        artistForm: song.enrichment.artistForm || null,
      },
      readyForQuiz: true,
      };
      selected.push(result);
      for (const artistId of song.artistIds) reservedArtists.add(artistId);
    }
  }
}

saveCache();
const eraCounts = Object.fromEntries(Object.keys(scaledTargets).map((era) => [era, selected.filter((song) => song.era === era).length]));
const recognitionCounts = Object.fromEntries(["recognizable", "middle", "deep"].map((band) => [band, selected.filter((song) => song.recognizability === band).length]));
const report = {
  version: 1,
  generatedAt,
  policy: {
    targetTotal,
    eraTargets: scaledTargets,
    uniqueArtists: true,
    approximateYearsAllowed: true,
    manualClipReviewRequired: false,
    optionalMetadataBlocksPublication: false,
  },
  stats: {
    readyForQuiz: selected.length,
    eraCounts,
    recognitionCounts,
    reservedArtistEntities: reservedArtists.size,
    networkSearches,
    cachedSearches: Object.keys(cache.queries).length,
    skippedCandidates: skipped.length,
  },
  songs: selected,
  skipped: skipped.slice(0, 200),
};

fs.writeFileSync(dataPath("quiz-ready-songs.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.stats, null, 2));
if (selected.length !== targetTotal) {
  throw new Error(`Prepared ${selected.length}/${targetTotal} songs; era counts: ${JSON.stringify(eraCounts)}`);
}
