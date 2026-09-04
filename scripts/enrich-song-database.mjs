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
const resolverVersion = 1;
const limit = Math.max(1, Number(process.env.ENRICH_LIMIT || 60));
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
  fs.renameSync(temporary, cachePath);
};

let lastMusicBrainzRequest = 0;
const fetchJson = async (url, { musicBrainz = false } = {}) => {
  let error;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (musicBrainz) {
      const delay = 1100 - (Date.now() - lastMusicBrainzRequest);
      if (delay > 0) await wait(delay);
      lastMusicBrainzRequest = Date.now();
    }
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": userAgent },
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) return response.json();
      if (response.status === 404) return null;
      if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`${response.status} ${response.statusText}`);
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1500 * (attempt + 1));
      error = new Error(`${response.status} ${response.statusText}`);
    } catch (caught) {
      error = caught;
      if (attempt < 2) await wait(1500 * (attempt + 1));
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
  if (existing?.resolverVersion === resolverVersion && existing.status === "matched") return existing;
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

const searchRecording = async (song) => {
  for (const isrc of song.externalIds?.isrc || []) {
    const isrcQuery = encodeURIComponent(`isrc:${String(isrc).replace(/[^A-Za-z0-9]/g, "")}`);
    const result = await musicBrainz(`recording?query=${isrcQuery}&limit=8`);
    const recordings = result?.recordings || [];
    const match = chooseRecording(song, recordings, aliasIndex, { exactIsrc: true });
    if (match.status === "matched") return { ...match, method: "exact-isrc", isrc };
  }
  const query = encodeURIComponent(`recording:"${String(song.title).replaceAll('"', "")}" AND artist:"${String(song.artist).replaceAll('"', "")}"`);
  const result = await musicBrainz(`recording?query=${query}&limit=8`);
  return { ...chooseRecording(song, result?.recordings || [], aliasIndex), method: "search" };
};

const enrichSong = async (song) => {
  const sourceFingerprint = inputFingerprint(song);
  const match = await searchRecording(song);
  if (match.status !== "matched") return {
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
  const recording = await musicBrainz(`recording/${match.recording.id}?inc=artists+isrcs+releases+release-groups`)
    || match.recording;
  const release = selectReleaseInfo(recording);
  const credits = recordingArtistCredits(recording);
  const artistMbids = [...new Set(credits.map(({ musicBrainzArtistId }) => musicBrainzArtistId).filter(Boolean))];
  for (const credit of credits) await enrichArtist(credit.musicBrainzArtistId, credit.name);
  const earliestChartYear = Math.min(...(song.chart?.years || []).map(Number).filter(Number.isFinite), Infinity);
  const yearConflict = release.firstReleaseYear && Number.isFinite(earliestChartYear) && release.firstReleaseYear > earliestChartYear + 1;
  const verified = match.method === "exact-isrc" && !yearConflict;
  return {
    resolverVersion,
    sourceFingerprint,
    status: "matched",
    overallState: verified ? "verified" : yearConflict ? "conflict" : "candidate",
    method: match.method,
    confidence: Number(match.score.toFixed(4)),
    runnerUpDelta: match.runnerUpDelta === null ? null : Number(match.runnerUpDelta.toFixed(4)),
    recordingMbid: recording.id,
    recordingTitle: recording.title,
    artistCredits: credits,
    artistMbids,
    isrcs: [...new Set(recording.isrcs || [])],
    releaseYear: release.firstReleaseYear,
    releaseYearState: verified ? "verified" : yearConflict ? "conflict" : "candidate",
    firstReleaseDate: release.firstReleaseDate,
    versionType: extractVersionType(recording.title),
    album: release.album,
    sources: [{ provider: "musicbrainz", entityId: recording.id, url: `https://musicbrainz.org/recording/${recording.id}` }],
    issues: yearConflict ? ["release-year-after-chart"] : [],
    retrievedAt: new Date().toISOString(),
  };
};

const now = Date.now();
const eligibleForEnrichment = (song) => song.status?.language === "russian"
  && (song.readyForCuration || song.readyForUniqueArtistQuiz || song.quizRefs?.length);
const queue = database.songs
  .filter(eligibleForEnrichment)
  .filter((song) => {
    const existing = cache.songs[song.id];
    const fingerprintMatches = existing?.sourceFingerprint === inputFingerprint(song) && existing?.resolverVersion === resolverVersion;
    if (!fingerprintMatches) return true;
    if (existing.status === "matched") return false;
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
