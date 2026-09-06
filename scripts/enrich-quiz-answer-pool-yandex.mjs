import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  artistsOverlap,
  buildAliasIndex,
  fingerprint,
  normalizeObservation,
  textSimilarity,
} from "./chart-normalization.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const poolPath = dataPath("song-pool-4.json");
const cachePath = dataPath("yandex-track-enrichment-cache.json");
const concurrency = Math.max(1, Number(process.env.YANDEX_CONCURRENCY || 4));
const pauseMs = Math.max(0, Number(process.env.YANDEX_PAUSE_MS || 120));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};
const coverUrl = (uri) => uri ? `https://${uri.replace("%%", "400x400")}` : null;
const aliasIndex = buildAliasIndex(readJson(dataPath("artist-aliases.json")));
const pool = readJson(poolPath);
const cache = fs.existsSync(cachePath) ? readJson(cachePath) : { version: 1, tracks: {} };
cache.tracks ||= {};

const requestJson = async (url, attempts = 4) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "LamtyuginMusicQuiz/1.0" },
        signal: AbortSignal.timeout(25_000),
      });
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) { lastError = error; }
    await wait(800 * (attempt + 1));
  }
  throw lastError || new Error("request failed");
};

const badVersion = /\b(?:live|remix|rmx|karaoke|instrumental|acoustic|sped\s*up|slowed|nightcore|cover)\b|концерт|ремикс|караоке|минусовк|акустическ|кавер/iu;
const identitySimilarity = (expected, actual) => {
  const expectedIdentity = normalizeObservation({ artist: expected, title: "" }, aliasIndex).artist;
  const actualIdentity = normalizeObservation({ artist: actual, title: "" }, aliasIndex).artist;
  if (artistsOverlap(expectedIdentity, actualIdentity)) return 1;
  return textSimilarity(fingerprint(expected), fingerprint(actual));
};
const titleSimilarity = (expected, actual) => {
  const left = normalizeObservation({ artist: "x", title: expected }, aliasIndex).titleKey;
  const right = normalizeObservation({ artist: "x", title: actual }, aliasIndex).titleKey;
  if (left === right) return 1;
  return textSimilarity(left, right);
};

async function enrich(track) {
  const query = `${track.artist} ${track.title}`.replace(/\s+/gu, " ").trim();
  const url = `https://api.music.yandex.net/search?text=${encodeURIComponent(query)}&type=track&page=0&nocorrect=false`;
  const document = await requestJson(url);
  const ranked = (document?.result?.tracks?.results || []).map((candidate) => {
    const remoteArtist = (candidate.artists || []).map(({ name }) => name).join(" & ");
    const artistScore = identitySimilarity(track.artist, remoteArtist);
    const titleScore = titleSimilarity(track.title, candidate.title);
    const score = 0.48 * artistScore + 0.52 * titleScore;
    return { candidate, remoteArtist, artistScore, titleScore, score };
  }).filter(({ candidate, artistScore, titleScore, score }) =>
    candidate.available && !badVersion.test(`${candidate.title} ${candidate.version || ""}`)
      && artistScore >= 0.62 && titleScore >= 0.78 && score >= 0.82)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best) return { status: "not-found", query, retrievedAt: new Date().toISOString() };
  const runnerUpDelta = ranked[1] ? best.score - ranked[1].score : null;
  if (runnerUpDelta !== null && runnerUpDelta < 0.015
    && String(best.candidate.title) !== String(ranked[1].candidate.title)) {
    return {
      status: "ambiguous", query, confidence: Number(best.score.toFixed(4)),
      alternatives: ranked.slice(0, 3).map(({ candidate, remoteArtist, score }) => ({ id: candidate.id, artist: remoteArtist, title: candidate.title, score: Number(score.toFixed(4)) })),
      retrievedAt: new Date().toISOString(),
    };
  }
  const candidate = best.candidate;
  const album = candidate.albums?.[0] || null;
  const primaryArtist = (candidate.artists || [])[0] || null;
  return {
    status: "matched",
    query,
    confidence: Number(best.score.toFixed(4)),
    runnerUpDelta: runnerUpDelta === null ? null : Number(runnerUpDelta.toFixed(4)),
    yandexTrackId: String(candidate.id),
    yandexArtistId: primaryArtist?.id ? String(primaryArtist.id) : null,
    remoteArtist: best.remoteArtist,
    remoteTitle: candidate.title,
    releaseYear: Number(album?.year) || null,
    album: album ? {
      title: album.title,
      kind: album.type === "single" || Number(album.trackCount) <= 3 ? "single" : "album",
      year: Number(album.year) || null,
      coverUrl: coverUrl(album.coverUri || candidate.coverUri),
      sourceUrl: `https://music.yandex.com/album/${album.id}/track/${candidate.id}`,
      rightsStatus: "contextual-only",
    } : null,
    artistImage: coverUrl(primaryArtist?.cover?.uri) ? {
      url: coverUrl(primaryArtist.cover.uri),
      sourceUrl: `https://music.yandex.com/artist/${primaryArtist.id}`,
      attribution: "Яндекс Музыка",
      rightsStatus: "contextual-only",
    } : null,
    sourceUrl: album?.id
      ? `https://music.yandex.com/album/${album.id}/track/${candidate.id}`
      : `https://music.yandex.com/track/${candidate.id}`,
    retrievedAt: new Date().toISOString(),
  };
}

const targets = pool.tracks.filter(({ candidateType }) => candidateType === "quiz-answer-pair");
const pending = targets.filter(({ id }) => !["matched", "not-found", "ambiguous"].includes(cache.tracks[id]?.status));
let cursor = 0;
let completed = 0;
async function worker() {
  while (cursor < pending.length) {
    const track = pending[cursor++];
    try { cache.tracks[track.id] = await enrich(track); }
    catch (error) { cache.tracks[track.id] = { status: "temporary-error", error: String(error?.message || error), retrievedAt: new Date().toISOString() }; }
    completed += 1;
    if (completed % 20 === 0 || completed === pending.length) {
      cache.generatedAt = new Date().toISOString();
      writeJson(cachePath, cache);
      console.log(`${completed}/${pending.length} pair enrichments`);
    }
    await wait(pauseMs);
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

for (const track of targets) {
  const result = cache.tracks[track.id];
  if (result?.status !== "matched") continue;
  if (result.confidence >= 0.9) {
    track.artist = result.remoteArtist || track.artist;
    track.title = result.remoteTitle || track.title;
  }
  track.yandexTrackId = result.yandexTrackId;
  track.yandexArtistId = result.yandexArtistId;
  track.releaseYear = result.releaseYear;
  track.listYear ||= result.releaseYear;
  track.album = result.album;
  track.artistImage = result.artistImage;
  track.metadataSourceUrl = result.sourceUrl;
  track.metadataConfidence = result.confidence;
}
const bandRank = { recognizable: 0, middle: 1, deep: 2 };
const databaseIndex = readJson(dataPath("song-database.json"));
const compressed = databaseIndex.archiveParts?.length
  ? Buffer.concat(databaseIndex.archiveParts.map((file) => fs.readFileSync(dataPath(file))))
  : fs.readFileSync(dataPath(databaseIndex.archive));
const database = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
const independentSongsByTitle = new Map();
for (const song of database.songs) {
  const independentlyKnown = Boolean(song.chart || song.quizRefs?.length
    || song.poolRefs?.some(({ file }) => file !== "song-pool-4.json"));
  if (!independentlyKnown) continue;
  if (!independentSongsByTitle.has(song.normalizedTitle)) independentSongsByTitle.set(song.normalizedTitle, []);
  independentSongsByTitle.get(song.normalizedTitle).push(song);
}
const independentlyKnown = (track) => {
  const normalized = normalizeObservation(track, aliasIndex);
  return (independentSongsByTitle.get(normalized.titleKey) || []).some((song) => {
    const sourceArtists = [song.artist, ...(song.artistAliases || [])]
      .map((artist) => normalizeObservation({ artist, title: track.title }, aliasIndex).artist);
    return sourceArtists.some((artist) => artistsOverlap(artist, normalized.artist));
  });
};
const deduplicated = [];
const byIdentity = new Map();
const byYandexTrack = new Map();
let duplicateRemoved = 0;
let existingRemoved = 0;
for (const track of pool.tracks) {
  if (independentlyKnown(track)) { existingRemoved += 1; continue; }
  const normalized = normalizeObservation(track, aliasIndex);
  const identityKey = `${[...normalized.artist.participants].sort().join("+")}:${normalized.titleKey}`;
  const existing = byIdentity.get(identityKey) || (track.yandexTrackId ? byYandexTrack.get(track.yandexTrackId) : null);
  if (!existing) {
    deduplicated.push(track);
    byIdentity.set(identityKey, track);
    if (track.yandexTrackId) byYandexTrack.set(track.yandexTrackId, track);
    continue;
  }
  duplicateRemoved += 1;
  existing.quizAnswerRefs = [...(existing.quizAnswerRefs || []), ...(track.quizAnswerRefs || [])];
  if ((bandRank[track.sourceBand] ?? 9) < (bandRank[existing.sourceBand] ?? 9)) existing.sourceBand = track.sourceBand;
  if (track.reviewStatus === "verified") existing.reviewStatus = "verified";
  if (existing.language !== track.language) existing.language = "mixed";
}
pool.tracks = deduplicated
  .sort((left, right) => left.artist.localeCompare(right.artist, "ru") || left.title.localeCompare(right.title, "ru"));
pool.count = pool.tracks.length;
pool.generatedAt = new Date().toISOString();
pool.enrichment = {
  provider: "Яндекс Музыка",
  cacheFile: "yandex-track-enrichment-cache.json",
  matched: targets.filter(({ id }) => cache.tracks[id]?.status === "matched").length,
  ambiguous: targets.filter(({ id }) => cache.tracks[id]?.status === "ambiguous").length,
  notFound: targets.filter(({ id }) => cache.tracks[id]?.status === "not-found").length,
  temporaryError: targets.filter(({ id }) => cache.tracks[id]?.status === "temporary-error").length,
  duplicateTracksRemoved: duplicateRemoved,
  existingDatabaseTracksRemoved: existingRemoved,
};
writeJson(poolPath, pool);
const reportPath = dataPath("quiz-answer-import-report.json");
if (fs.existsSync(reportPath)) {
  const report = readJson(reportPath);
  report.generatedAt = pool.generatedAt;
  report.stats.outputTracks = pool.tracks.length;
  report.stats.duplicateTracksRemovedAfterMetadata = duplicateRemoved;
  report.stats.existingTracksRemovedAfterMetadata = existingRemoved;
  writeJson(reportPath, report);
}
console.log(JSON.stringify({ targets: targets.length, pending: pending.length, ...pool.enrichment }, null, 2));
