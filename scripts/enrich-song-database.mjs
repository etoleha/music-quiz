import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { buildAliasIndex, fingerprint } from "./chart-normalization.mjs";
import {
  chooseRecording,
  compareEnrichmentPriority,
  extractVersionType,
  inferArtistForm,
  isAllowedCommonsLicense,
  recordingArtistCredits,
  selectReleaseInfo,
} from "./enrichment-core.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const resolverVersion = 6;
const limit = Math.max(1, Number(process.env.ENRICH_LIMIT || 60));
const targetQuizId = String(process.env.ENRICH_QUIZ_ID || "").trim();
const targetSongIds = new Set(String(process.env.ENRICH_SONG_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
const readyOnly = process.env.ENRICH_READY_ONLY === "1";
const forceTargeted = process.env.ENRICH_FORCE === "1";
const appleOnly = process.env.ENRICH_APPLE_ONLY === "1";
const deezerOnly = process.env.ENRICH_DEEZER_ONLY === "1";
const userAgent = "LamtyuginMusicQuiz/1.0 (https://quiz.lamtyugin.com)";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const aliases = readJson(dataPath("artist-aliases.json"));
const aliasIndex = buildAliasIndex(aliases);

const index = readJson(dataPath("song-database.json"));
const compressed = Array.isArray(index.archiveParts) && index.archiveParts.length
  ? Buffer.concat(index.archiveParts.map((file) => fs.readFileSync(dataPath(file))))
  : fs.readFileSync(dataPath(index.archive));
const database = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
const cachePath = dataPath("song-enrichment-auto.json");
const cache = readJson(cachePath);
cache.version = 1;
cache.resolverVersion = resolverVersion;
cache.songs ||= {};
cache.artists ||= {};

const inputFingerprint = (song) => crypto.createHash("sha256").update(JSON.stringify({
  artist: song.artist,
  title: song.title,
  artistAliases: song.artistAliases,
  titleAliases: song.titleAliases,
  artistIds: song.artistIds,
  isrcs: song.externalIds?.isrc || [],
  resolverVersion,
})).digest("hex");

const atomicWriteCache = () => {
  cache.generatedAt = new Date().toISOString();
  cache.stats = Object.values(cache.songs).reduce((stats, song) => {
    stats.attempted += 1;
    if (song.status === "matched") stats.matched += 1;
    else if (song.status === "ambiguous") stats.ambiguous += 1;
    else if (song.status === "not-found") stats.notFound += 1;
    else if (song.status === "temporary-error") stats.temporaryError += 1;
    return stats;
  }, { attempted: 0, matched: 0, ambiguous: 0, notFound: 0, temporaryError: 0 });
  const temporary = `${cachePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`);
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.renameSync(temporary, cachePath);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code) || attempt === 5) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
    }
  }
  throw lastError;
};

let lastMusicBrainzRequest = 0;
const fetchJson = async (url, { musicBrainz = false, attempts = 3, timeoutMs = 20000 } = {}) => {
  let error;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (musicBrainz) {
      const delay = 1100 - (Date.now() - lastMusicBrainzRequest);
      if (delay > 0) await wait(delay);
      lastMusicBrainzRequest = Date.now();
    }
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": userAgent },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response.json();
      if (response.status === 404) return null;
      if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`${response.status} ${response.statusText}`);
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1500 * (attempt + 1));
      error = new Error(`${response.status} ${response.statusText}`);
    } catch (caught) {
      error = caught;
      if (attempt < attempts - 1) await wait(1500 * (attempt + 1));
    }
  }
  throw error || new Error("request failed");
};

const musicBrainz = (resource) => fetchJson(`https://musicbrainz.org/ws/2/${resource}${resource.includes("?") ? "&" : "?"}fmt=json`, { musicBrainz: true });
const publicJson = (url) => fetchJson(url);
const qidFromRelations = (relations = []) => relations
  .find((relation) => relation.type === "wikidata" && /\/Q\d+$/.test(relation.url?.resource || ""))
  ?.url?.resource?.match(/Q\d+$/)?.[0];
const yearOf = (value) => Number(String(value || "").match(/(?:19|20)\d{2}/)?.[0]) || null;
const stripHtml = (value = "") => String(value).replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
const statementEntityIds = (claims = [], limitValue = 4) => claims
  .flatMap((claim) => typeof claim.mainsnak?.datavalue?.value === "object" && claim.mainsnak.datavalue.value?.id
    ? [String(claim.mainsnak.datavalue.value.id)]
    : [])
  .slice(0, limitValue);

const wikidataDetails = async (qid) => {
  if (!qid) return { facts: [], photo: null, sources: [] };
  const document = await publicJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const entity = document?.entities?.[qid];
  const claims = entity?.claims || {};
  const eventIds = statementEntityIds(claims.P1344, 3);
  const awardIds = statementEntityIds(claims.P166, 3);
  const relatedIds = [...new Set([...eventIds, ...awardIds])];
  let labels = {};
  if (relatedIds.length) {
    const labelDocument = await publicJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${relatedIds.join("%7C")}&props=labels&languages=ru%7Cen&format=json&origin=*`);
    labels = Object.fromEntries(Object.entries(labelDocument?.entities || {}).map(([id, item]) => [
      id,
      item.labels?.ru?.value || item.labels?.en?.value || id,
    ]));
  }
  const sourceUrl = `https://www.wikidata.org/wiki/${qid}`;
  const facts = [
    ...eventIds.map((id) => ({ kind: "participation", text: `Среди заметных событий — участие в проекте «${labels[id] || id}».`, sourceUrl, state: "candidate" })),
    ...awardIds.map((id) => ({ kind: "award", text: `Среди наград — «${labels[id] || id}».`, sourceUrl, state: "candidate" })),
  ].filter(({ text }) => text.length <= 180).slice(0, 3);

  const imageName = claims.P18?.map((claim) => claim.mainsnak?.datavalue?.value).find((value) => typeof value === "string");
  let photo = null;
  if (imageName) {
    const imageDocument = await publicJson(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${imageName}`)}&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=480&format=json&origin=*`);
    const info = Object.values(imageDocument?.query?.pages || {})[0]?.imageinfo?.[0];
    const metadata = info?.extmetadata || {};
    const license = metadata.LicenseShortName?.value;
    const attribution = stripHtml(metadata.Artist?.value || metadata.Credit?.value);
    const licenseUrl = metadata.LicenseUrl?.value;
    if (info?.thumburl?.startsWith("https://") && info.descriptionurl?.startsWith("https://")
      && attribution && licenseUrl?.startsWith("https://") && isAllowedCommonsLicense(license)) {
      photo = {
        url: info.thumburl,
        sourceUrl: info.descriptionurl,
        attribution,
        license,
        licenseUrl,
        rightsStatus: "freely-licensed",
        retrievedAt: new Date().toISOString(),
      };
    }
  }
  return { facts, photo, sources: [{ provider: "wikidata", entityId: qid, url: sourceUrl }] };
};

const enrichArtist = async (musicBrainzArtistId, fallbackName) => {
  const existing = cache.artists[musicBrainzArtistId];
  if (existing?.status === "matched") return existing;
  const artist = await musicBrainz(`artist/${musicBrainzArtistId}?inc=artist-rels+url-rels`);
  if (!artist) return null;
  const wikidataQid = qidFromRelations(artist.relations);
  const wikidata = await wikidataDetails(wikidataQid).catch((error) => ({ facts: [], photo: null, sources: [], partialError: String(error.message || error) }));
  const memberRelations = (artist.relations || []).filter((relation) =>
    relation.type === "member of band"
    && relation.artist?.name
    && (relation.direction === "backward" || relation.artist?.type === "Person"));
  const mapMember = (relation) => ({
    name: relation.artist.name,
    musicBrainzArtistId: relation.artist.id,
    roles: relation.attributes || [],
    isVocalist: (relation.attributes || []).some((attribute) => /vocal|singer/i.test(attribute)),
    since: yearOf(relation.begin),
    until: yearOf(relation.end),
    sourceUrl: `https://musicbrainz.org/artist/${musicBrainzArtistId}`,
  });
  const profile = {
    resolverVersion,
    status: "matched",
    name: artist.name || fallbackName,
    musicBrainzArtistId,
    wikidataQid: wikidataQid || null,
    artistForm: inferArtistForm({ type: artist.type, gender: artist.gender }),
    country: artist.area?.name || artist.country || null,
    activeYears: artist["life-span"]?.begin ? {
      since: yearOf(artist["life-span"].begin),
      until: yearOf(artist["life-span"].end),
      ended: Boolean(artist["life-span"].ended),
    } : null,
    members: {
      current: memberRelations.filter((relation) => !relation.end).map(mapMember),
      former: memberRelations.filter((relation) => relation.end).map(mapMember),
      state: memberRelations.length ? "candidate" : "not-found",
    },
    photo: wikidata.photo,
    facts: wikidata.facts,
    sources: [
      { provider: "musicbrainz", entityId: musicBrainzArtistId, url: `https://musicbrainz.org/artist/${musicBrainzArtistId}` },
      ...wikidata.sources,
    ],
    retrievedAt: new Date().toISOString(),
    partialError: wikidata.partialError || null,
  };
  cache.artists[musicBrainzArtistId] = profile;
  return profile;
};

const appleRecording = (result) => ({
  id: `apple:${result.trackId}`,
  title: result.trackName,
  score: 100,
  "first-release-date": result.releaseDate || null,
  "artist-credit": [{ name: result.artistName, artist: { name: result.artistName } }],
  apple: {
    trackId: result.trackId,
    collectionName: result.collectionName || null,
    collectionViewUrl: result.collectionViewUrl || null,
    trackViewUrl: result.trackViewUrl || null,
    artworkUrl: result.artworkUrl100?.replace(/100x100(?:bb)?/u, "600x600bb") || null,
    trackCount: Number(result.trackCount) || null,
    releaseDate: result.releaseDate || null,
  },
});

const searchAppleRecording = async (song) => {
  const terms = [...new Set([
    `${song.artist} ${song.title}`,
    `${song.artistAliases?.[0] || ""} ${song.titleAliases?.[0] || ""}`,
  ].map((value) => value.replace(/\s+/gu, " ").trim()).filter(Boolean))];
  let best = null;
  for (const country of ["RU"]) {
    for (const term of terms) {
      await wait(175);
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&media=music&entity=song&limit=25`;
      const document = await fetchJson(url, { attempts: 2, timeoutMs: 8000 });
      const recordings = (document?.results || [])
        .filter((result) => result.kind === "song" && result.trackId && result.trackName && result.artistName)
        .map(appleRecording);
      const distinct = [...new Map(recordings.map((recording) => [
        `${fingerprint(recording.title)}:${fingerprint(recording["artist-credit"]?.[0]?.name)}`,
        recording,
      ])).values()];
      const candidate = { ...chooseRecording(song, distinct, aliasIndex), method: "apple-search", provider: "apple" };
      if (candidate.status === "matched") return candidate;
      if (!best || (candidate.score || 0) > (best.score || 0)) best = candidate;
    }
  }
  return best || { status: "not-found", method: "apple-search", provider: "apple", alternatives: [] };
};

const deezerRecording = (result) => {
  const contributors = result.contributors?.length ? result.contributors : [result.artist];
  return {
    id: `deezer:${result.id}`,
    title: result.title_short || result.title,
    score: 100,
    "first-release-date": result.release_date || null,
    "artist-credit": contributors.filter(Boolean).map((artist, index) => ({
      name: artist.name,
      artist: { name: artist.name },
      joinphrase: index < contributors.length - 1 ? " & " : "",
    })),
    deezer: {
      trackId: result.id,
      trackUrl: result.link || `https://www.deezer.com/track/${result.id}`,
      releaseDate: result.release_date || null,
      albumTitle: result.album?.title || null,
      albumId: result.album?.id || null,
      artworkUrl: result.album?.cover_xl || result.album?.cover_big || null,
    },
  };
};

const searchDeezerRecording = async (song) => {
  const terms = [...new Set([
    `${song.artist} ${song.title}`,
    `${song.artistAliases?.[0] || ""} ${song.titleAliases?.[0] || ""}`,
  ].map((value) => value.replace(/\s+/gu, " ").trim()).filter(Boolean))];
  let best = null;
  for (const term of terms) {
    const search = await fetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=5`, { attempts: 2, timeoutMs: 8000 });
    const details = await Promise.all((search?.data || []).slice(0, 3).map((result) =>
      fetchJson(`https://api.deezer.com/track/${result.id}`, { attempts: 2, timeoutMs: 8000 }).catch(() => result)));
    const recordings = details.filter(Boolean).map(deezerRecording);
    const distinct = [...new Map(recordings.map((recording) => [
      `${fingerprint(recording.title)}:${recording["artist-credit"].map(({ name }) => fingerprint(name)).join("+")}`,
      recording,
    ])).values()];
    const candidate = { ...chooseRecording(song, distinct, aliasIndex), method: "deezer-search", provider: "deezer" };
    if (candidate.status === "matched") return candidate;
    if (!best || (candidate.score || 0) > (best.score || 0)) best = candidate;
  }
  return best || { status: "not-found", method: "deezer-search", provider: "deezer", alternatives: [] };
};

const searchRecording = async (song) => {
  if (appleOnly) return searchAppleRecording(song);
  if (deezerOnly) return searchDeezerRecording(song);
  for (const isrc of song.externalIds?.isrc || []) {
    const isrcQuery = encodeURIComponent(`isrc:${String(isrc).replace(/[^A-Za-z0-9]/g, "")}`);
    const result = await musicBrainz(`recording?query=${isrcQuery}&limit=8`);
    const recordings = result?.recordings || [];
    const match = chooseRecording(song, recordings, aliasIndex, { exactIsrc: true });
    if (match.status === "matched") return { ...match, method: "exact-isrc", isrc };
  }
  const unique = (values) => [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
  const normalizeSearchText = (value) => String(value)
    .replace(/[«»„“”]/gu, '"')
    .replace(/\s+/gu, " ")
    .trim();
  const cleanTitleForSearch = (value) => normalizeSearchText(value)
    .replace(/\s*[[(](?:prod(?:uced)?\.?\s+by|ost|саундтрек|из\s+(?:сериала|фильма))\b[^\])]*[\])]/giu, "")
    .replace(/\s*[-–—]\s*(?:ost|саундтрек|из\s+(?:сериала|фильма))\b.*$/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const artists = unique([song.artist, ...(song.artistAliases || [])].map(normalizeSearchText)).slice(0, 5);
  const titles = unique([
    song.title,
    cleanTitleForSearch(song.title),
    ...(song.titleAliases || []),
    ...(song.titleAliases || []).map(cleanTitleForSearch),
  ].map(normalizeSearchText)).slice(0, 5);
  const pairs = unique([
    JSON.stringify([artists[0], titles[0]]),
    ...artists.slice(1).map((artist) => JSON.stringify([artist, titles[0]])),
    ...titles.slice(1).map((title) => JSON.stringify([artists[0], title])),
    ...artists.slice(1).flatMap((artist) => titles.slice(1).map((title) => JSON.stringify([artist, title]))),
  ]).map((pair) => JSON.parse(pair)).slice(0, 12);
  let best = null;
  for (let index = 0; index < pairs.length; index += 1) {
    const [artist, title] = pairs[index];
    const query = encodeURIComponent(`recording:"${title.replaceAll('"', "")}" AND artist:"${artist.replaceAll('"', "")}"`);
    const result = await musicBrainz(`recording?query=${query}&limit=8`);
    const candidate = { ...chooseRecording(song, result?.recordings || [], aliasIndex), method: index ? "alias-search" : "search" };
    if (candidate.status === "matched") return candidate;
    if (!best || (candidate.score || 0) > (best.score || 0)) best = candidate;
  }
  if (best?.status === "matched") return best;
  const apple = await searchAppleRecording(song).catch(() => null);
  if (!apple) return best || { status: "not-found", method: "search", alternatives: [] };
  return apple.status === "matched" || (apple.score || 0) > (best?.score || 0)
    ? apple
    : best || apple;
};

const enrichSong = async (song) => {
  const sourceFingerprint = inputFingerprint(song);
  const match = await searchRecording(song);
  const usableCandidate = match.status === "ambiguous"
    && match.score >= 0.88
    && match.title >= 0.95
    && match.artists >= 0.85
    && (match.runnerUpDelta === null || match.runnerUpDelta >= 0.03);
  if (match.status !== "matched" && !usableCandidate) return {
    resolverVersion,
    sourceFingerprint,
    status: match.status,
    method: match.method,
    confidence: Number((match.score || 0).toFixed(4)),
    runnerUpDelta: match.runnerUpDelta === null || match.runnerUpDelta === undefined ? null : Number(match.runnerUpDelta.toFixed(4)),
    alternatives: match.alternatives,
    retrievedAt: new Date().toISOString(),
    retryAfter: new Date(Date.now() + (match.status === "ambiguous" ? 365 : 180) * 24 * 60 * 60 * 1000).toISOString(),
  };
  const recording = match.provider === "apple" || match.provider === "deezer"
    ? match.recording
    : await musicBrainz(`recording/${match.recording.id}?inc=artists+isrcs+releases+release-groups`) || match.recording;
  const release = match.provider === "apple" ? {
    firstReleaseYear: yearOf(recording.apple?.releaseDate),
    firstReleaseDate: recording.apple?.releaseDate || null,
    album: recording.apple?.collectionName ? {
      title: recording.apple.collectionName.replace(/\s+-\s+(?:Single|EP)$/iu, ""),
      kind: /\s+-\s+Single$/iu.test(recording.apple.collectionName) || (recording.apple.trackCount && recording.apple.trackCount <= 3) ? "single" : "album",
      year: yearOf(recording.apple.releaseDate),
      coverUrl: recording.apple.artworkUrl,
      sourceUrl: recording.apple.collectionViewUrl || recording.apple.trackViewUrl,
      rightsStatus: "contextual-only",
    } : null,
  } : match.provider === "deezer" ? {
    firstReleaseYear: yearOf(recording.deezer?.releaseDate),
    firstReleaseDate: recording.deezer?.releaseDate || null,
    album: recording.deezer?.albumTitle ? {
      title: recording.deezer.albumTitle,
      kind: "album",
      year: yearOf(recording.deezer.releaseDate),
      coverUrl: recording.deezer.artworkUrl,
      sourceUrl: recording.deezer.albumId ? `https://www.deezer.com/album/${recording.deezer.albumId}` : recording.deezer.trackUrl,
      rightsStatus: "contextual-only",
    } : null,
  } : selectReleaseInfo(recording);
  if (release.album?.releaseGroupMbid) {
    const coverDocument = await publicJson(`https://coverartarchive.org/release-group/${release.album.releaseGroupMbid}`)
      .catch(() => null);
    const cover = coverDocument?.images?.find((image) => image.front) || coverDocument?.images?.[0];
    release.album.coverUrl = cover?.thumbnails?.["500"] || cover?.thumbnails?.large || cover?.image || null;
  }
  const credits = recordingArtistCredits(recording);
  const artistMbids = [...new Set(credits.map(({ musicBrainzArtistId }) => musicBrainzArtistId).filter(Boolean))];
  for (const credit of credits) {
    if (credit.musicBrainzArtistId) await enrichArtist(credit.musicBrainzArtistId, credit.name);
  }
  const earliestChartYear = Math.min(...(song.chart?.years || []).map(Number).filter(Number.isFinite), Infinity);
  const yearConflict = release.firstReleaseYear && Number.isFinite(earliestChartYear) && release.firstReleaseYear > earliestChartYear + 1;
  const verified = match.status === "matched" && match.method === "exact-isrc" && !yearConflict;
  const source = match.provider === "apple"
    ? { provider: "apple", entityId: String(recording.apple.trackId), url: recording.apple.trackViewUrl || recording.apple.collectionViewUrl }
    : match.provider === "deezer"
      ? { provider: "deezer", entityId: String(recording.deezer.trackId), url: recording.deezer.trackUrl }
      : { provider: "musicbrainz", entityId: recording.id, url: `https://musicbrainz.org/recording/${recording.id}` };
  return {
    resolverVersion,
    sourceFingerprint,
    status: "matched",
    overallState: verified ? "verified" : yearConflict ? "conflict" : "candidate",
    method: usableCandidate ? `${match.method}-candidate` : match.method,
    confidence: Number(match.score.toFixed(4)),
    runnerUpDelta: match.runnerUpDelta === null ? null : Number(match.runnerUpDelta.toFixed(4)),
    recordingMbid: match.provider === "apple" || match.provider === "deezer" ? null : recording.id,
    recordingTitle: recording.title,
    artistCredits: credits,
    artistMbids,
    isrcs: [...new Set(recording.isrcs || [])],
    releaseYear: release.firstReleaseYear,
    releaseYearState: verified ? "verified" : yearConflict ? "conflict" : "candidate",
    firstReleaseDate: release.firstReleaseDate,
    versionType: extractVersionType(recording.title),
    album: release.album,
    sources: [source],
    issues: [
      ...(yearConflict ? ["release-year-after-chart"] : []),
      ...(usableCandidate ? ["ambiguous-recording-choice"] : []),
    ],
    retrievedAt: new Date().toISOString(),
  };
};

const now = Date.now();
const eligibleForEnrichment = (song) => song.status?.language === "russian"
  && (song.readyForCuration || song.readyForUniqueArtistQuiz || song.quizRefs?.length);
const queue = database.songs
  .filter(eligibleForEnrichment)
  .filter((song) => !targetQuizId || song.quizRefs?.some(({ quizId }) => quizId === targetQuizId))
  .filter((song) => !targetSongIds.size || targetSongIds.has(song.id))
  .filter((song) => !readyOnly || song.readyForPublication)
  .filter((song) => {
    const existing = cache.songs[song.id];
    const fingerprintMatches = existing?.sourceFingerprint === inputFingerprint(song) && existing?.resolverVersion === resolverVersion;
    if (forceTargeted && targetSongIds.has(song.id)) return true;
    if (existing?.status === "matched" && fingerprintMatches) return false;
    if (!fingerprintMatches) return true;
    return !existing.retryAfter || Date.parse(existing.retryAfter) <= now;
  })
  .sort(compareEnrichmentPriority)
  .slice(0, limit);

let processed = 0;
for (const song of queue) {
  try {
    cache.songs[song.id] = await enrichSong(song);
  } catch (error) {
    cache.songs[song.id] = {
      resolverVersion,
      sourceFingerprint: inputFingerprint(song),
      status: "temporary-error",
      error: String(error?.message || error).slice(0, 300),
      retrievedAt: new Date().toISOString(),
      retryAfter: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }
  processed += 1;
  if (processed % 5 === 0) atomicWriteCache();
  console.log(`${processed}/${queue.length} ${song.artist} — ${song.title}: ${cache.songs[song.id].status}`);
}
atomicWriteCache();
console.log(JSON.stringify({ processed, queued: queue.length, stats: cache.stats }, null, 2));
