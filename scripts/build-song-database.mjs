import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  artistsOverlap,
  buildAliasIndex,
  fingerprint,
  normalizeArtist,
  normalizeObservation,
} from "./chart-normalization.mjs";
import {
  applyArtistCreditOverride,
  artistIdentityFromStatusOverride,
  externalIdsFromStatusOverride,
  publicationBlockersFor,
  quizReadinessBlockersFor,
  validateSongStatusOverrides,
} from "./song-status-overrides.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const generatedAt = process.env.SONG_DATABASE_GENERATED_AT || new Date().toISOString();

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const aliases = readJson(dataPath("artist-aliases.json"));
const aliasIndex = buildAliasIndex(aliases);
const canonicalArtistNames = new Map(aliases.artists.map(({ canonical }) => [fingerprint(canonical), canonical]));
const overrides = readJson(dataPath("song-status-overrides.json"));
validateSongStatusOverrides(overrides);
const enrichmentOverrides = readJson(dataPath("song-enrichment-overrides.json"));
const enrichmentAuto = readJson(dataPath("song-enrichment-auto.json"));
const readyPool = fs.existsSync(dataPath("quiz-ready-songs.json"))
  ? readJson(dataPath("quiz-ready-songs.json"))
  : { songs: [] };
const preparedBySongId = new Map((readyPool.songs || []).map((song) => [song.songId, song]));
if (preparedBySongId.size !== (readyPool.songs || []).length) throw new Error("quiz-ready-songs.json contains duplicate songId values");
const catalogIndex = readJson(dataPath("chart-catalog.json"));
const catalogArchive = catalogIndex.archive
  ? JSON.parse(zlib.gunzipSync(fs.readFileSync(dataPath(catalogIndex.archive))).toString("utf8"))
  : null;
const catalogTracks = catalogArchive?.tracks
  || (catalogIndex.parts || []).flatMap((file) => readJson(dataPath(file)).tracks || []);
const poolFiles = fs.readdirSync(dataPath()).filter((file) => /^song-pool(?:-(?:\d+|soviet))?\.json$/.test(file)).sort();

const unique = (values) => [...new Set(values.filter(Boolean).map(String))];
const uniqueNumbers = (values) => [...new Set(values.filter(validYear).map(Number))];
const externalKey = (namespace, value) => `${namespace}:${fingerprint(value)}`;
const identityKey = (normalizedArtist, normalizedTitle) => `${normalizedArtist.primary}:${normalizedTitle}`;
const hasCyrillic = (value) => /[а-яёіїєґ]/iu.test(value || "");
const validYear = (value) => Number.isInteger(Number(value)) && Number(value) >= 1900 && Number(value) <= 2100;
const yearsFromValues = (values) => uniqueNumbers(values.flatMap((value) => String(value || "").match(/(?:19|20)\d{2}/g) || [])).sort();

const splitArguments = (source) => {
  const values = [];
  let current = "";
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quote) {
      current += character;
      if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "[" || character === "{" || character === "(") depth += 1;
    if (character === "]" || character === "}" || character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      values.push(current.trim());
      current = "";
    } else current += character;
  }
  if (current.trim()) values.push(current.trim());
  return values;
};

const literal = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readQuizTracks = () => {
  const tracks = [];
  for (const file of ["app/quiz-data.ts", "app/quiz-data-extra.ts"]) {
    let quizId = null;
    for (const line of fs.readFileSync(path.join(repoRoot, file), "utf8").split(/\r?\n/)) {
      const id = line.match(/^\s*id:\s*"([^"]+)"/)?.[1];
      if (id) quizId = id;
      const call = line.match(/^\s*(track|extraTrack)\((.*)\),?\s*$/);
      if (!call) continue;
      const args = splitArguments(call[2]);
      const youtubeId = literal(args[0]);
      const artist = literal(args[1]);
      const isExtra = call[1] === "extraTrack";
      const artistAliases = isExtra ? [artist] : (literal(args[2]) || []);
      const title = literal(args[isExtra ? 2 : 3]);
      const titleAliases = isExtra ? [title] : (literal(args[4]) || []);
      if (!youtubeId || !artist || !title || !quizId) throw new Error(`Cannot read quiz track: ${file}: ${line.trim()}`);
      tracks.push({ quizId, youtubeId, artist, title, artistAliases, titleAliases });
    }
  }
  return tracks;
};

const entries = [];
const titleIndex = new Map();
const externalIndex = new Map();

const indexEntry = (entry) => {
  if (!titleIndex.has(entry.normalizedTitle)) titleIndex.set(entry.normalizedTitle, []);
  titleIndex.get(entry.normalizedTitle).push(entry);
  for (const [namespace, values] of Object.entries(entry.externalIds)) {
    for (const value of values) externalIndex.set(externalKey(namespace, value), entry);
  }
};

const attachExternalIds = (entry, ids = {}) => {
  for (const [namespace, values] of Object.entries(ids)) {
    const clean = unique(Array.isArray(values) ? values : [values]);
    if (!clean.length) continue;
    entry.externalIds[namespace] = unique([...(entry.externalIds[namespace] || []), ...clean]).sort();
    for (const value of clean) externalIndex.set(externalKey(namespace, value), entry);
  }
};

const findEntry = ({ artist, title }, ids = {}) => {
  const idMatches = new Set();
  for (const [namespace, values] of Object.entries(ids)) {
    for (const value of unique(Array.isArray(values) ? values : [values])) {
      const match = externalIndex.get(externalKey(namespace, value));
      if (match) idMatches.add(match);
    }
  }
  if (idMatches.size === 1) return [...idMatches][0];
  const normalized = normalizeObservation({ artist, title }, aliasIndex);
  return (titleIndex.get(normalized.titleKey) || []).find((entry) =>
    artistsOverlap(entry.normalizedArtist, normalized.artist)) || null;
};

const newEntry = ({ id, artist, title, artistAliases = [], titleAliases = [], externalIds = {}, explicit = false }) => {
  const normalized = normalizeObservation({ artist, title }, aliasIndex);
  const canonicalArtist = canonicalArtistNames.get(normalized.artist.primary) || artist;
  const entry = {
    id,
    artist: canonicalArtist,
    title: normalized.cleanTitle || title,
    artistAliases: unique([canonicalArtist, artist, ...artistAliases]),
    titleAliases: unique([title, normalized.cleanTitle, ...titleAliases]),
    normalizedArtist: normalized.artist,
    normalizedTitle: normalized.titleKey,
    externalIds: {},
    explicit: Boolean(explicit),
    chart: null,
    poolRefs: [],
    quizRefs: [],
    publishedArtistCredits: [],
  };
  entries.push(entry);
  indexEntry(entry);
  attachExternalIds(entry, externalIds);
  return entry;
};

const addAliases = (entry, artistValues, titleValues) => {
  entry.artistAliases = unique([...entry.artistAliases, ...artistValues]).sort((a, b) => a.localeCompare(b, "ru"));
  entry.titleAliases = unique([...entry.titleAliases, ...titleValues]).sort((a, b) => a.localeCompare(b, "ru"));
  if (!hasCyrillic(entry.artist) && artistValues.some(hasCyrillic)) entry.artist = artistValues.find(hasCyrillic);
  if (!hasCyrillic(entry.title) && titleValues.some(hasCyrillic)) entry.title = titleValues.find(hasCyrillic);
};

for (const track of catalogTracks) {
  const entry = newEntry({
    id: track.id,
    artist: track.artist,
    title: track.title,
    artistAliases: track.artistAliases,
    titleAliases: track.titleAliases,
    externalIds: track.externalIds,
    explicit: track.explicit,
  });
  entry.chart = {
    chartId: track.id,
    combinedScore: track.combinedScore,
    sourceCount: track.sourceCount,
    sourceIds: Object.keys(track.sources || {}).sort(),
    years: yearsFromValues(Object.values(track.sources || {}).flatMap(({ firstSeen, lastSeen }) => [firstSeen, lastSeen])),
    topHitLanguageCodes: track.sources?.["tophit-ru-monthly-history"]?.languageCodes || [],
    topHitLanguageNames: track.sources?.["tophit-ru-monthly-history"]?.languageNames || [],
  };
  const topHitReleaseDates = track.sources?.["tophit-ru-monthly-history"]?.releaseDates || [];
  entry.releaseYearCandidates = yearsFromValues(topHitReleaseDates).map((year) => ({ year, source: "tophit-ru-monthly-history" }));
}

for (const file of poolFiles) {
  const pool = readJson(dataPath(file));
  for (const track of pool.tracks || []) {
    const ids = track.spotifyTrackId ? { spotify: [track.spotifyTrackId] } : {};
    let entry = findEntry(track, ids);
    if (!entry) {
      const normalized = normalizeObservation(track, aliasIndex);
      const digest = crypto.createHash("sha1").update(identityKey(normalized.artist, normalized.titleKey)).digest("hex").slice(0, 12);
      entry = newEntry({ id: `pool-${digest}`, artist: track.artist, title: track.title, externalIds: ids });
    }
    addAliases(entry, [track.artist], [track.title]);
    attachExternalIds(entry, ids);
    entry.poolRefs.push({
      file,
      id: track.id,
      listYear: track.listYear ?? null,
      listRank: track.listRank ?? null,
      chartScore: track.chartScore ?? null,
      sourceBand: track.sourceBand ?? null,
      sourceUrl: track.sourceUrl ?? null,
    });
  }
}

for (const track of readQuizTracks()) {
  const ids = { youtube: [track.youtubeId] };
  let entry = findEntry(track, ids);
  if (!entry) {
    const normalized = normalizeObservation(track, aliasIndex);
    const digest = crypto.createHash("sha1").update(identityKey(normalized.artist, normalized.titleKey)).digest("hex").slice(0, 12);
    entry = newEntry({ id: `quiz-${digest}`, artist: track.artist, title: track.title, externalIds: ids });
  }
  addAliases(entry, [track.artist, ...track.artistAliases], [track.title, ...track.titleAliases]);
  attachExternalIds(entry, ids);
  entry.publishedArtistCredits = unique([...(entry.publishedArtistCredits || []), track.artist]);
  entry.quizRefs.push({ quizId: track.quizId, youtubeId: track.youtubeId });
}

const classifyLanguage = (entry) => {
  const topHitLanguages = entry.chart?.topHitLanguageCodes || [];
  if (topHitLanguages.length > 1) return { value: "mixed", confidence: "high", evidence: [`tophit-language:${topHitLanguages.join("+")}`] };
  if (topHitLanguages[0] === "russian") return { value: "russian", confidence: "high", evidence: ["tophit-language:russian"] };
  if (topHitLanguages.length === 1) return { value: "foreign", confidence: "high", evidence: [`tophit-language:${topHitLanguages[0]}`] };
  const titleHasCyrillic = entry.titleAliases.some(hasCyrillic);
  const artistHasCyrillic = entry.artistAliases.some(hasCyrillic);
  if (entry.quizRefs.length) return { value: "russian", confidence: "high", evidence: ["published-russian-quiz"] };
  if (titleHasCyrillic) return { value: "russian", confidence: "high", evidence: ["cyrillic-title"] };
  if (entry.poolRefs.length) return { value: "russian", confidence: artistHasCyrillic ? "medium" : "low", evidence: ["curated-russian-pool"] };
  if (entry.chart?.sourceIds?.includes("tophit-ru-monthly-history")) {
    return { value: "unknown", confidence: "low", evidence: ["tophit-may-translate-title"] };
  }
  return { value: "foreign", confidence: "low", evidence: ["latin-only-russia-chart"] };
};

const statusValues = {
  workflowStatus: new Set(["waiting", "used", "rejected"]),
  language: new Set(["russian", "foreign", "mixed", "unknown"]),
  reviewStatus: new Set(["verified", "needs-review"]),
  fragmentStatus: new Set(["good", "bad", "not-checked"]),
};

const overrideFor = (entry) => overrides.songs?.[entry.id]
  || overrides.songs?.[identityKey(entry.normalizedArtist, entry.normalizedTitle)]
  || {};

const enrichmentFor = (entry) => enrichmentOverrides.songs?.[entry.id]
  || enrichmentOverrides.songs?.[identityKey(entry.normalizedArtist, entry.normalizedTitle)]
  || {};

const automaticEnrichmentFor = (entry) => enrichmentAuto.songs?.[entry.id]
  || enrichmentAuto.songs?.[identityKey(entry.normalizedArtist, entry.normalizedTitle)]
  || {};

// Resolve each override against the untouched source identity. A manual credit can
// change normalizedArtist, so looking the override up again afterwards would lose
// overrides keyed by normalizedArtist:normalizedTitle.
const statusOverridesByEntry = new Map(entries.map((entry) => [entry, overrideFor(entry)]));
const enrichmentOverridesByEntry = new Map(entries.map((entry) => [entry, enrichmentFor(entry)]));
const automaticEnrichmentByEntry = new Map(entries.map((entry) => [entry, automaticEnrichmentFor(entry)]));

for (const entry of entries) {
  const manual = statusOverridesByEntry.get(entry);
  attachExternalIds(entry, externalIdsFromStatusOverride(manual, `status override for ${entry.id}`));
  const preparation = preparedBySongId.get(entry.id);
  if (preparation?.youtube?.videoId) attachExternalIds(entry, { youtube: [preparation.youtube.videoId] });
  const manualIdentity = artistIdentityFromStatusOverride(manual, `status override for ${entry.id}`);
  applyArtistCreditOverride(entry, manualIdentity);
}

for (const entry of entries) {
  const manualIdentity = artistIdentityFromStatusOverride(statusOverridesByEntry.get(entry), `status override for ${entry.id}`);
  // Alternate spellings are accepted answers, not additional credited people.
  const creditValues = entry.publishedArtistCredits?.length ? entry.publishedArtistCredits : [entry.artist];
  const resolvedArtistIds = manualIdentity?.artistIds
    || unique(creditValues.flatMap((value) => normalizeArtist(value, aliasIndex).participants)).sort();
  const registryResolved = resolvedArtistIds.length > 0 && resolvedArtistIds.every((artistId) => canonicalArtistNames.has(artistId));
  const sourceCreditResolved = Object.values(entry.externalIds).some((values) => values.length > 0)
    || (entry.chart?.sourceCount || 0) > 1
    || entry.poolRefs.length > 0;
  entry.artistIdentityResolution = manualIdentity ? "manual-override"
    : registryResolved ? "registry"
    : entry.quizRefs.length ? "published-credit"
      : sourceCreditResolved ? "source-credit"
        : "unresolved";
  entry.artistIdentityResolved = entry.artistIdentityResolution !== "unresolved";
  entry.artistIds = resolvedArtistIds.length ? resolvedArtistIds : [`unknown:${entry.id}`];
  entry.normalizedArtist = {
    primary: manualIdentity?.artistIds[0] || normalizeArtist(entry.artist, aliasIndex).primary,
    participants: entry.artistIds,
  };
}

const usedArtistIds = new Set(entries.filter(({ quizRefs }) => quizRefs.length).flatMap(({ artistIds }) => artistIds));

for (const entry of entries) {
  const manual = statusOverridesByEntry.get(entry);
  const enrichment = enrichmentOverridesByEntry.get(entry);
  const automaticEnrichment = automaticEnrichmentByEntry.get(entry);
  const preparation = preparedBySongId.get(entry.id) || null;
  if (preparation && JSON.stringify(preparation.artistIds) !== JSON.stringify(entry.artistIds)) {
    throw new Error(`quiz-ready-songs.json artist identity is stale for ${entry.id}`);
  }
  const automaticLanguage = classifyLanguage(entry);
  const language = manual.language || automaticLanguage.value;
  const workflowStatus = manual.workflowStatus || (entry.quizRefs.length ? "used" : entry.explicit ? "rejected" : "waiting");
  const fragmentStatus = manual.fragmentStatus || (entry.quizRefs.length ? "good" : "not-checked");
  const stableIdentity = Object.values(entry.externalIds).some((values) => values.length > 0)
    || (entry.chart?.sourceCount || 0) > 1
    || entry.poolRefs.length > 0;
  const reviewStatus = manual.reviewStatus || (entry.quizRefs.length || (stableIdentity && language !== "unknown") ? "verified" : "needs-review");
  for (const [field, value] of Object.entries({ workflowStatus, language, reviewStatus, fragmentStatus })) {
    if (!statusValues[field].has(value)) throw new Error(`Invalid ${field}=${value} for ${entry.id}`);
  }
  const bestPoolRank = Math.min(...entry.poolRefs.map(({ listRank }) => listRank).filter(Number.isFinite), Infinity);
  const poolScore = entry.poolRefs.length * 20 + (Number.isFinite(bestPoolRank) ? Math.max(0, 30 - bestPoolRank / 10) : 0);
  entry.candidateScore = Number(((entry.chart?.combinedScore || 0) + poolScore).toFixed(2));
  entry.status = {
    workflow: workflowStatus,
    language,
    languageConfidence: manual.language ? "manual" : automaticLanguage.confidence,
    languageEvidence: manual.language ? ["manual-override"] : automaticLanguage.evidence,
    review: reviewStatus,
    fragment: fragmentStatus,
  };
  entry.quizCandidate = workflowStatus === "waiting" && !entry.explicit && language === "russian" && fragmentStatus !== "bad";
  entry.usedArtistIds = entry.artistIds.filter((artistId) => usedArtistIds.has(artistId));
  entry.allArtistsUnused = entry.usedArtistIds.length === 0;
  const candidateReleaseYears = [
    ...(entry.releaseYearCandidates || []),
    ...(validYear(preparation?.approximateYear) ? [{ year: Number(preparation.approximateYear), source: "quiz-ready-pool" }] : []),
    ...(validYear(automaticEnrichment.releaseYear) ? [{
      year: Number(automaticEnrichment.releaseYear),
      source: automaticEnrichment.releaseYearState === "verified" ? "musicbrainz-isrc" : "musicbrainz-search",
    }] : []),
  ].filter((candidate, index, candidates) => candidates.findIndex(({ year }) => Number(year) === Number(candidate.year)) === index);
  const automaticReleaseYear = candidateReleaseYears.length === 1 ? candidateReleaseYears[0].year : null;
  const identifierReleaseYear = automaticEnrichment.releaseYearState === "verified" && validYear(automaticEnrichment.releaseYear)
    ? Number(automaticEnrichment.releaseYear)
    : null;
  const preparedReleaseYear = validYear(preparation?.approximateYear) ? Number(preparation.approximateYear) : null;
  entry.release = {
    releaseYear: validYear(enrichment.releaseYear) ? Number(enrichment.releaseYear) : identifierReleaseYear || preparedReleaseYear || automaticReleaseYear,
    releaseYearStatus: validYear(enrichment.releaseYear) || identifierReleaseYear ? "verified" : preparedReleaseYear || automaticReleaseYear ? "candidate" : "missing",
    versionYear: validYear(enrichment.versionYear) ? Number(enrichment.versionYear) : null,
    versionType: enrichment.versionType || automaticEnrichment.versionType || "original",
    album: enrichment.album || automaticEnrichment.album || null,
    candidateYears: candidateReleaseYears,
  };
  const artistProfiles = (automaticEnrichment.artistMbids || []).map((id) => enrichmentAuto.artists?.[id]).filter(Boolean);
  entry.enrichment = {
    artistForm: enrichment.artistForm || artistProfiles[0]?.artistForm || null,
    performers: enrichment.performers || automaticEnrichment.artistCredits || [],
    artistImage: enrichment.artistImage || artistProfiles.find(({ photo }) => photo)?.photo || null,
    facts: enrichment.facts || artistProfiles.flatMap(({ facts = [] }) => facts).slice(0, 3),
    sources: enrichment.sources || unique([
      ...(automaticEnrichment.sources || []).map(({ url }) => url),
      ...artistProfiles.flatMap(({ sources = [] }) => sources.map(({ url }) => url)),
    ]),
    review: enrichment.review || automaticEnrichment.overallState || (entry.release.releaseYearStatus === "verified" ? "verified" : entry.release.candidateYears.length === 1 ? "candidate" : "needs-review"),
  };
  entry.readyForCuration = entry.quizCandidate && reviewStatus === "verified" && entry.artistIdentityResolved;
  entry.readyForUniqueArtistQuiz = entry.readyForCuration && entry.allArtistsUnused;
  entry.quizPreparation = preparation;
  entry.metadataBlockers = publicationBlockersFor(entry, { language, reviewStatus, fragmentStatus });
  entry.publicationBlockers = quizReadinessBlockersFor(entry, preparation, { workflowStatus });
  entry.publicationProgress = Number(((8 - entry.publicationBlockers.length) / 8).toFixed(3));
  entry.readyForPublication = entry.publicationBlockers.length === 0;
  entry.readyForAutomaticQuiz = entry.readyForPublication && entry.allArtistsUnused;
  if (manual.notes) entry.notes = unique(Array.isArray(manual.notes) ? manual.notes : [manual.notes]);
  delete entry.releaseYearCandidates;
}

entries.sort((left, right) =>
  Number(right.quizCandidate) - Number(left.quizCandidate)
  || right.candidateScore - left.candidateScore
  || left.artist.localeCompare(right.artist, "ru")
  || left.title.localeCompare(right.title, "ru"));

const countBy = (getter) => Object.fromEntries(
  [...entries.reduce((map, entry) => map.set(getter(entry), (map.get(getter(entry)) || 0) + 1), new Map())]
    .sort(([left], [right]) => left.localeCompare(right)),
);

const stats = {
  songs: entries.length,
  chartSongs: entries.filter(({ chart }) => chart).length,
  poolPositions: entries.reduce((sum, { poolRefs }) => sum + poolRefs.length, 0),
  poolSongs: entries.filter(({ poolRefs }) => poolRefs.length).length,
  publishedQuizSongs: entries.filter(({ quizRefs }) => quizRefs.length).length,
  quizTrackPositions: entries.reduce((sum, { quizRefs }) => sum + quizRefs.length, 0),
  quizCandidates: entries.filter(({ quizCandidate }) => quizCandidate).length,
  readyForCuration: entries.filter(({ readyForCuration }) => readyForCuration).length,
  readyForUniqueArtistQuiz: entries.filter(({ readyForUniqueArtistQuiz }) => readyForUniqueArtistQuiz).length,
  readyForPublication: entries.filter(({ readyForPublication }) => readyForPublication).length,
  readyForAutomaticQuiz: entries.filter(({ readyForAutomaticQuiz }) => readyForAutomaticQuiz).length,
  usedArtists: usedArtistIds.size,
  withReleaseYear: entries.filter(({ release }) => release.releaseYear).length,
  withCandidateReleaseYear: entries.filter(({ release }) => release.candidateYears.length).length,
  withAutomaticEnrichment: entries.filter(({ enrichment }) => enrichment.sources.length).length,
  workflow: countBy(({ status }) => status.workflow),
  language: countBy(({ status }) => status.language),
  review: countBy(({ status }) => status.review),
  fragment: countBy(({ status }) => status.fragment),
};

const archiveName = "song-database.json.gz";
const archivePartSize = 700 * 1024;
const archive = {
  version: 2,
  generatedAt,
  stats,
  songs: entries,
};
const compressedArchive = zlib.gzipSync(Buffer.from(JSON.stringify(archive)), { level: 9 });
const archiveSha256 = crypto.createHash("sha256").update(compressedArchive).digest("hex");
fs.writeFileSync(dataPath(archiveName), compressedArchive);
const archiveParts = [];
for (let offset = 0, part = 1; offset < compressedArchive.length; offset += archivePartSize, part += 1) {
  const partName = `${archiveName}.part-${String(part).padStart(2, "0")}`;
  fs.writeFileSync(dataPath(partName), compressedArchive.subarray(offset, offset + archivePartSize));
  archiveParts.push(partName);
}
fs.writeFileSync(dataPath("song-database.json"), `${JSON.stringify({
  version: 2,
  generatedAt,
  archive: archiveName,
  archiveParts,
  archiveSha256,
  stats,
  statusDimensions: {
    workflow: ["waiting", "used", "rejected"],
    language: ["russian", "foreign", "mixed", "unknown"],
    review: ["verified", "needs-review"],
    fragment: ["good", "bad", "not-checked"],
    enrichmentReview: ["verified", "candidate", "needs-review", "conflict"],
  },
}, null, 2)}\n`);

const reviewSongs = entries
  .filter(({ status }) => status.review === "needs-review" || status.language === "unknown")
  .slice(0, 500)
  .map((entry) => ({
    id: entry.id,
    artist: entry.artist,
    title: entry.title,
    candidateScore: entry.candidateScore,
    workflow: entry.status.workflow,
    language: entry.status.language,
    languageEvidence: entry.status.languageEvidence,
    releaseYear: entry.release.releaseYear,
    candidateYears: entry.release.candidateYears,
    artistIds: entry.artistIds,
    usedArtistIds: entry.usedArtistIds,
    readyForCuration: entry.readyForCuration,
    readyForUniqueArtistQuiz: entry.readyForUniqueArtistQuiz,
    readyForPublication: entry.readyForPublication,
    sourceIds: entry.chart?.sourceIds || [],
    poolRefs: entry.poolRefs.map(({ file, id }) => ({ file, id })),
    externalIds: entry.externalIds,
  }));
fs.writeFileSync(dataPath("song-database-review.json"), `${JSON.stringify({
  version: 1,
  generatedAt,
  totalNeedsReview: entries.filter(({ status }) => status.review === "needs-review").length,
  shown: reviewSongs.length,
  songs: reviewSongs,
}, null, 2)}\n`);

console.log(JSON.stringify(stats, null, 2));
