import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  artistsOverlap,
  buildAliasIndex,
  fingerprint,
  normalizeObservation,
} from "./chart-normalization.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const generatedAt = process.env.SONG_DATABASE_GENERATED_AT || new Date().toISOString();

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const aliases = readJson(dataPath("artist-aliases.json"));
const aliasIndex = buildAliasIndex(aliases);
const canonicalArtistNames = new Map(aliases.artists.map(({ canonical }) => [fingerprint(canonical), canonical]));
const overrides = readJson(dataPath("song-status-overrides.json"));
const catalogIndex = readJson(dataPath("chart-catalog.json"));
const catalogArchive = catalogIndex.archive
  ? JSON.parse(zlib.gunzipSync(fs.readFileSync(dataPath(catalogIndex.archive))).toString("utf8"))
  : null;
const catalogTracks = catalogArchive?.tracks
  || (catalogIndex.parts || []).flatMap((file) => readJson(dataPath(file)).tracks || []);
const poolFiles = fs.readdirSync(dataPath()).filter((file) => /^song-pool(?:-\d+)?\.json$/.test(file)).sort();

const unique = (values) => [...new Set(values.filter(Boolean).map(String))];
const externalKey = (namespace, value) => `${namespace}:${fingerprint(value)}`;
const identityKey = (normalizedArtist, normalizedTitle) => `${normalizedArtist.primary}:${normalizedTitle}`;
const hasCyrillic = (value) => /[а-яёіїєґ]/iu.test(value || "");

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
  };
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
  entry.quizRefs.push({ quizId: track.quizId, youtubeId: track.youtubeId });
}

const classifyLanguage = (entry) => {
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

for (const entry of entries) {
  const manual = overrideFor(entry);
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
  entry.readyForAutomaticQuiz = entry.quizCandidate && reviewStatus === "verified";
  if (manual.notes) entry.notes = unique(Array.isArray(manual.notes) ? manual.notes : [manual.notes]);
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
  readyForAutomaticQuiz: entries.filter(({ readyForAutomaticQuiz }) => readyForAutomaticQuiz).length,
  workflow: countBy(({ status }) => status.workflow),
  language: countBy(({ status }) => status.language),
  review: countBy(({ status }) => status.review),
  fragment: countBy(({ status }) => status.fragment),
};

const archiveName = "song-database.json.gz";
const archive = {
  version: 1,
  generatedAt,
  stats,
  songs: entries,
};
fs.writeFileSync(dataPath(archiveName), zlib.gzipSync(Buffer.from(JSON.stringify(archive)), { level: 9 }));
fs.writeFileSync(dataPath("song-database.json"), `${JSON.stringify({
  version: 1,
  generatedAt,
  archive: archiveName,
  stats,
  statusDimensions: {
    workflow: ["waiting", "used", "rejected"],
    language: ["russian", "foreign", "mixed", "unknown"],
    review: ["verified", "needs-review"],
    fragment: ["good", "bad", "not-checked"],
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
