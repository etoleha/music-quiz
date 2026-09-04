import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { rankYouTubeResults, searchYouTubeVideos } from "./youtube-search.mjs";
import {
  applyArtistCreditOverride,
  artistIdentityFromStatusOverride,
  validateSongStatusOverrides,
} from "./song-status-overrides.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const outputPath = process.env.READY_POOL_OUTPUT
  ? path.resolve(repoRoot, process.env.READY_POOL_OUTPUT)
  : dataPath("quiz-ready-songs.json");
const generatedAt = process.env.READY_POOL_GENERATED_AT || new Date().toISOString();
const targetTotal = Math.max(1, Number(process.env.READY_POOL_LIMIT || 1000));
const maxNetworkSearches = Math.max(targetTotal, Number(process.env.READY_POOL_MAX_SEARCHES || Math.ceil(targetTotal * 1.6)));
const maxSongsPerArtist = Math.max(1, Number(process.env.READY_POOL_MAX_PER_ARTIST || 20));
const offline = process.argv.includes("--offline");

// The ready inventory is deliberately broader than a single quiz. Scarce eras
// are selected first; unused capacity is filled from other eras afterwards.
const eraWeights = { soviet: 0.07, "1990s": 0.05, "2000s": 0.34, "2010s": 0.29, "2020s": 0.25 };
const scaledTargets = Object.fromEntries(Object.entries(eraWeights).map(([era, weight]) => [era, Math.floor(weight * targetTotal)]));
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
const statusOverrides = readJson(dataPath("song-status-overrides.json"));
validateSongStatusOverrides(statusOverrides);
const statusOverrideFor = (song) => statusOverrides.songs?.[song.id]
  || statusOverrides.songs?.[`${song.normalizedArtist?.primary}:${song.normalizedTitle}`]
  || {};

// The database and the ready pool are mutually derived. Apply identity/status
// corrections here as well so a new manual override can bootstrap both files in
// one rebuild instead of being rejected as a stale ready-pool snapshot.
for (const song of database.songs) {
  const manual = statusOverrideFor(song);
  const identity = artistIdentityFromStatusOverride(manual, `status override for ${song.id}`);
  applyArtistCreditOverride(song, identity);
  if (identity) song.artistIds = [...identity.artistIds];
  if (manual.workflowStatus) song.status.workflow = manual.workflowStatus;
  if (manual.language) song.status.language = manual.language;
}
const artistIdOverlaps = (artistId, collection) => [...collection].some((other) =>
  artistId === other || (Math.min(artistId.length, other.length) >= 5 && (artistId.includes(other) || other.includes(artistId))));
const anyArtistOverlaps = (artistIds, collection) => artistIds.some((artistId) => artistIdOverlaps(artistId, collection));
const usedArtistIds = new Set(database.songs.filter((song) => song.quizRefs?.length).flatMap((song) => song.artistIds));
for (const song of database.songs) song.allArtistsUnused = !anyArtistOverlaps(song.artistIds, usedArtistIds);
const songsByPoolId = new Map();
for (const song of database.songs) {
  for (const reference of song.poolRefs || []) songsByPoolId.set(reference.id, song);
}

const poolFiles = fs.readdirSync(dataPath()).filter((file) => /^song-pool(?:-(?:\d+|soviet|90s))?\.json$/.test(file)).sort();
const poolTracks = poolFiles.flatMap((file) => readJson(dataPath(file)).tracks.map((track) => ({ ...track, poolFile: file })));
const cachePath = dataPath("youtube-search-cache.json");
const loadedCache = fs.existsSync(cachePath) ? readJson(cachePath) : null;
const cache = loadedCache?.version === 2 ? loadedCache : { version: 2, queries: {} };
cache.queries ||= {};

const saveCache = () => {
  cache.updatedAt = new Date().toISOString();
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
};

const approximateYearFor = (track, song) => {
  if (Number.isInteger(track.listYear)) return Number(track.listYear);
  if (Number.isInteger(song?.release?.releaseYear)) return Number(song.release.releaseYear);
  const chartYears = (song?.chart?.years || []).map(Number).filter(Number.isInteger).sort((left, right) => left - right);
  return chartYears[0] || null;
};

const eraFor = (track, song) => {
  if (track.poolFile === "song-pool-soviet.json") return "soviet";
  const year = approximateYearFor(track, song);
  if (!year) return null;
  const decade = Math.floor(year / 10) * 10;
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
  if (track.poolFile === "song-pool-3.json") return "russian-chart-cyrillic-or-high-confidence";
  if (/Золотой граммофон/iu.test(track.sourceName || "")) return "golden-gramophone";
  return "trusted-russian-collection";
};

const sourceNameFor = (track) => track.sourceName
  || (track.poolFile === "song-pool-soviet.json" ? "Песня года / советская эстрада"
    : track.poolFile === "song-pool-3.json" ? "Spotify Daily Chart — Russia"
      : "Lezza TV — русская подборка");

const eligibleSourceFor = (track, song) => track.poolFile !== "song-pool-3.json"
  || song?.status?.languageConfidence === "high"
  || /[а-яёіїєґ]/iu.test(`${track.artist} ${track.title}`);

const knownBadPoolIds = new Set(["pool-0029", "pool-0197", "pool-0356", "pool-0431", "pool-0432", "pool-1302", "pool-0478"]);
const suspiciousMetadata = (track, song) => knownBadPoolIds.has(track.id)
  || /клип[_\s-]*\d|\bcover\b|\bremix\b|караоке|минусовк/iu.test(`${track.artist} ${track.title}`)
  || (/\bvs\.?\b/iu.test(track.artist) && song?.artistIds?.length === 1);

const buildCandidateQueues = ({ requireUnusedArtists }) => Object.fromEntries(Object.keys(scaledTargets).map((era) => [era, orderCandidates(poolTracks.filter((track) => {
    const song = songsByPoolId.get(track.id);
    if (eraFor(track, song) !== era || suspiciousMetadata(track, song) || !eligibleSourceFor(track, song)) return false;
    if (!song?.readyForCuration || song.status?.workflow !== "waiting" || song.quizRefs?.length) return false;
    return !requireUnusedArtists || (song.allArtistsUnused && !anyArtistOverlaps(song.artistIds, usedArtistIds));
  }))]));

const candidateQueues = buildCandidateQueues({ requireUnusedArtists: true });
const fallbackCandidateQueues = buildCandidateQueues({ requireUnusedArtists: false });

const selected = [];
const skipped = [];
const artistUseCounts = new Map();
const selectedSongIds = new Set();
const selectedVideoIds = new Set();
let networkSearches = 0;
const searchConcurrency = Math.max(1, Number(process.env.READY_POOL_CONCURRENCY || 6));

const matchingArtistKeys = (artistId) => [...artistUseCounts.keys()].filter((other) => artistIdOverlaps(artistId, new Set([other])));
const artistUseCount = (artistIds) => Math.max(0, ...artistIds.flatMap((artistId) => matchingArtistKeys(artistId).map((key) => artistUseCounts.get(key) || 0)));
const reserveArtists = (artistIds) => {
  for (const artistId of artistIds) {
    const key = matchingArtistKeys(artistId)[0] || artistId;
    artistUseCounts.set(key, (artistUseCounts.get(key) || 0) + 1);
  }
};

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

const cursors = Object.fromEntries(Object.keys(candidateQueues).map((era) => [era, 0]));
const fillEra = async (era, target, queues = candidateQueues, queueCursors = cursors) => {
  while (selected.filter((song) => song.era === era).length < target && queueCursors[era] < queues[era].length) {
    const batch = [];
    while (batch.length < searchConcurrency && queueCursors[era] < queues[era].length) {
      const track = queues[era][queueCursors[era]++];
      const song = songsByPoolId.get(track.id);
      if (!song || selectedSongIds.has(song.id) || artistUseCount(song.artistIds) >= maxSongsPerArtist) continue;
      batch.push({ track, song });
    }
    const videos = await Promise.all(batch.map(({ track }) => findVideo(track)));
    for (let index = 0; index < batch.length; index += 1) {
      if (selected.filter((song) => song.era === era).length >= target) break;
      const { track, song } = batch[index];
      const video = videos[index];
      if (!video || selectedSongIds.has(song.id) || selectedVideoIds.has(video.videoId) || artistUseCount(song.artistIds) >= maxSongsPerArtist) continue;
      const recognition = recognitionFor(track);
      const clipDuration = durationFor(recognition);
      const approximateYear = approximateYearFor(track, song);
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
      artistNovelty: song.allArtistsUnused && !anyArtistOverlaps(song.artistIds, usedArtistIds)
        ? "new-artist"
        : "previously-used-artist",
      eligibility: {
        approved: true,
        evidence: sourceEvidenceFor(track),
        sourceName: sourceNameFor(track),
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
        releaseYearStatus: song.release.releaseYearStatus || "candidate",
        album: song.release.album || null,
        artistImage: song.enrichment.artistImage || null,
        artistForm: song.enrichment.artistForm || null,
        performers: song.enrichment.performers || [],
        facts: song.enrichment.facts || [],
        sources: song.enrichment.sources || [],
      },
      readyForQuiz: true,
      };
      selected.push(result);
      selectedSongIds.add(song.id);
      selectedVideoIds.add(video.videoId);
      reserveArtists(song.artistIds);
    }
  }
};

for (const [era, target] of Object.entries(scaledTargets)) await fillEra(era, target);

// Reallocate quota shortages instead of failing because the current source set
// contains fewer Soviet/1990s candidates than the ideal long-term balance.
while (selected.length < targetTotal) {
  const before = selected.length;
  for (const era of Object.keys(candidateQueues).sort((left, right) =>
    (candidateQueues[right].length - cursors[right]) - (candidateQueues[left].length - cursors[left]))) {
    if (selected.length >= targetTotal) break;
    await fillEra(era, selected.filter((song) => song.era === era).length + Math.min(searchConcurrency, targetTotal - selected.length));
  }
  if (selected.length === before) break;
}

// A large reusable inventory may also contain new songs by artists heard in an
// older quiz. They are kept only as overflow stock: the scheduled quiz builder
// still excludes them from upcoming releases via artistNovelty and its own
// no-repeat rule. This prevents a temporary YouTube outage or newly resolved
// artist alias from shrinking the prepared inventory.
if (selected.length < targetTotal) {
  const fallbackCursors = Object.fromEntries(Object.keys(fallbackCandidateQueues).map((era) => [era, 0]));
  while (selected.length < targetTotal) {
    const before = selected.length;
    for (const era of Object.keys(fallbackCandidateQueues).sort((left, right) =>
      (fallbackCandidateQueues[right].length - fallbackCursors[right]) - (fallbackCandidateQueues[left].length - fallbackCursors[left]))) {
      if (selected.length >= targetTotal) break;
      await fillEra(
        era,
        selected.filter((song) => song.era === era).length + Math.min(searchConcurrency, targetTotal - selected.length),
        fallbackCandidateQueues,
        fallbackCursors,
      );
    }
    if (selected.length === before) break;
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
    uniqueArtistsWithinQuiz: true,
    maxSongsPerArtistInInventory: maxSongsPerArtist,
    approximateYearsAllowed: true,
    manualClipReviewRequired: false,
    optionalMetadataBlocksPublication: false,
  },
  stats: {
    readyForQuiz: selected.length,
    eraCounts,
    recognitionCounts,
    reservedArtistEntities: artistUseCounts.size,
    newArtistSongs: selected.filter((song) => song.artistNovelty === "new-artist").length,
    previousArtistOverflowSongs: selected.filter((song) => song.artistNovelty === "previously-used-artist").length,
    distinctYouTubeVideos: selectedVideoIds.size,
    distinctSongs: selectedSongIds.size,
    networkSearches,
    cachedSearches: Object.keys(cache.queries).length,
    skippedCandidates: skipped.length,
  },
  songs: selected,
  skipped: skipped.slice(0, 200),
};

fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.stats, null, 2));
if (selected.length !== targetTotal) {
  throw new Error(`Prepared ${selected.length}/${targetTotal} songs; era counts: ${JSON.stringify(eraCounts)}`);
}
