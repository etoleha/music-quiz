import crypto from "node:crypto";
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
const resultsPath = (...parts) => path.join(repoRoot, "results", ...parts);
const fetchArtists = process.argv.includes("--fetch-artists");
const retryNotFound = process.argv.includes("--retry-not-found");
const concurrency = Math.max(1, Number(process.env.YANDEX_CONCURRENCY || 3));
const pauseMs = Math.max(0, Number(process.env.YANDEX_PAUSE_MS || 150));
const generatedAt = new Date().toISOString();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};

function parseCsv(text) {
  text = text.replace(/^\uFEFF/u, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/u, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/u, "")); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

const aliases = readJson(dataPath("artist-aliases.json"));
const aliasIndex = buildAliasIndex(aliases);
const databaseIndex = readJson(dataPath("song-database.json"));
const compressed = databaseIndex.archiveParts?.length
  ? Buffer.concat(databaseIndex.archiveParts.map((file) => fs.readFileSync(dataPath(file))))
  : fs.readFileSync(dataPath(databaseIndex.archive));
if (databaseIndex.archiveSha256
  && crypto.createHash("sha256").update(compressed).digest("hex") !== databaseIndex.archiveSha256) {
  throw new Error("Song database archive checksum mismatch");
}
const database = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
const existingByTitle = new Map();
for (const song of database.songs) {
  const independentlyKnown = Boolean(song.chart || song.quizRefs?.length
    || song.poolRefs?.some(({ file }) => file !== "song-pool-4.json"));
  if (!independentlyKnown) continue;
  if (!existingByTitle.has(song.normalizedTitle)) existingByTitle.set(song.normalizedTitle, []);
  existingByTitle.get(song.normalizedTitle).push(song);
}

const identityOf = (artist, title) => {
  const normalized = normalizeObservation({ artist, title }, aliasIndex);
  return {
    normalized,
    key: `${[...normalized.artist.participants].sort().join("+")}:${normalized.titleKey}`,
  };
};
const existingMatch = (artist, title) => {
  const { normalized } = identityOf(artist, title);
  return (existingByTitle.get(normalized.titleKey) || []).find((song) =>
    artistsOverlap(song.normalizedArtist, normalized.artist)) || null;
};

const normalizedLanguage = (value, artist = "", title = "") => {
  const source = String(value || "").toLocaleLowerCase("ru-RU");
  if (/иностран|foreign|eng\b/u.test(source)) return "foreign";
  if (/смеш|mixed|рус\+|rus\+/u.test(source)) {
    if (/[а-яё]/iu.test(title)) return "russian";
    if (/[a-z]/iu.test(title)) return "foreign";
    return "mixed";
  }
  if (/рус|russian|совет/u.test(source)) return "russian";
  if (/[а-яё]/iu.test(title)) return "russian";
  if (/[a-z]/iu.test(`${artist} ${title}`)) return "foreign";
  return "unknown";
};

const sourceBandForNew = (row) => {
  const hint = `${row.quiz_title || ""} ${row.round_title || ""}`.toLocaleLowerCase("ru-RU");
  if (/л[её]гк|easy|нович/u.test(hint)) return "recognizable";
  if (/средн|medium/u.test(hint)) return "middle";
  if (/сложн|hard|эксперт|профи|задрот/u.test(hint)) return "deep";
  if (/разминк/u.test(hint)) return "middle";
  return "deep";
};

const oldRows = parseCsv(fs.readFileSync(resultsPath("all-answers.csv"), "utf8"));
const newRows = parseCsv(fs.readFileSync(resultsPath("new-quizzes", "music-answers-final.csv"), "utf8"));
const observations = [
  ...oldRows.map((row) => ({
    format: "legacy", quizId: row.quiz_id, quizTitle: `Квиз первого формата (${row.quiz_id})`,
    musicType: row.music_type, round: row.round, roundTitle: "", question: row.question,
    artist: row.artist?.trim(), title: row.song?.trim(), confidence: row.confidence,
    reviewStatus: row.confidence === "high" ? "verified" : "needs-review",
    evidenceFrame: row.evidence_frame || "", sourceBand: "middle",
  })),
  ...newRows.map((row) => ({
    format: "modern", quizId: row.quiz_id, quizTitle: row.quiz_title,
    musicType: row.music_type || row.quiz_music_type, round: row.round, roundTitle: row.round_title,
    question: row.question, artist: row.artist?.trim(), title: row.song?.trim(), confidence: row.confidence,
    reviewStatus: /OCR high|visually verified/iu.test(row.review_status || "") ? "verified" : "needs-review",
    evidenceFrame: row.evidence_frame || "", sourceBand: sourceBandForNew(row),
  })),
].filter(({ artist }) => artist);

const sourceRef = (row) => ({
  format: row.format,
  quizId: row.quizId,
  quizTitle: row.quizTitle,
  round: row.round,
  roundTitle: row.roundTitle,
  question: row.question,
  confidence: row.confidence,
  reviewStatus: row.reviewStatus,
  evidenceFrame: row.evidenceFrame,
});
const bandRank = { recognizable: 0, middle: 1, deep: 2 };
const easiestBand = (refs) => refs.map(({ sourceBand }) => sourceBand)
  .sort((left, right) => bandRank[left] - bandRank[right])[0] || "middle";
const languageForRefs = (refs, artist, title) => {
  const values = [...new Set(refs.map(({ musicType }) => normalizedLanguage(musicType, artist, title)).filter((value) => value !== "unknown"))];
  return values.length === 1 ? values[0] : values.length > 1 ? "mixed" : normalizedLanguage("", artist, title);
};

const incomingPairs = new Map();
const existingPairs = [];
const artistOnly = new Map();
const expandArtistSeeds = (credit) => {
  const cleaned = String(credit || "").replace(/\s+/gu, " ").trim();
  if (!cleaned) return [];
  const annotationParts = cleaned.split(/\s+[—–-]\s+(?:кавер|клип):\s*/iu);
  const parts = annotationParts.flatMap((part) => {
    if (/^25\s*\/\s*17$/u.test(part)) return ["25/17"];
    return part.split(/\s+(?:\/|\+)\s+/u);
  });
  return [...new Set(parts.map((part) => part.replace(/\s*\([^)]*\)\s*$/u, "").trim()).filter(Boolean))];
};
for (const observation of observations) {
  if (observation.title) {
    const match = existingMatch(observation.artist, observation.title);
    if (match) {
      existingPairs.push({ ...sourceRef(observation), artist: observation.artist, title: observation.title, existingSongId: match.id });
      continue;
    }
    const identity = identityOf(observation.artist, observation.title);
    const current = incomingPairs.get(identity.key) || {
      artist: observation.artist,
      title: observation.title,
      normalizedArtist: identity.normalized.artist,
      normalizedTitle: identity.normalized.titleKey,
      refs: [],
    };
    current.refs.push({ ...sourceRef(observation), sourceBand: observation.sourceBand, musicType: observation.musicType });
    incomingPairs.set(identity.key, current);
  } else {
    for (const artist of expandArtistSeeds(observation.artist)) {
      const normalized = normalizeObservation({ artist, title: "" }, aliasIndex).artist;
      const key = [...normalized.participants].sort().join("+") || fingerprint(artist);
      const current = artistOnly.get(key) || { artist, normalizedArtist: normalized, refs: [] };
      current.refs.push({ ...sourceRef(observation), sourceBand: observation.sourceBand, musicType: observation.musicType });
      artistOnly.set(key, current);
    }
  }
}

const selectedKeys = new Set(incomingPairs.keys());
const yandexCachePath = dataPath("yandex-artist-selection-cache.json");
const yandexCache = fs.existsSync(yandexCachePath)
  ? readJson(yandexCachePath)
  : { version: 1, generatedAt, artists: {} };
yandexCache.artists ||= {};

const requestJson = async (url, attempts = 4) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "LamtyuginMusicQuiz/1.0" },
        signal: AbortSignal.timeout(25_000),
      });
      if (response.ok) return response.json();
      if (response.status === 404) return null;
      lastError = new Error(`${response.status} ${response.statusText}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) { lastError = error; }
    await wait(800 * (attempt + 1));
  }
  throw lastError || new Error("request failed");
};

const badVersion = /\b(?:live|remix|rmx|karaoke|instrumental|acoustic|sped\s*up|slowed|nightcore|cover)\b|концерт|ремикс|караоке|минусовк|акустическ|кавер/iu;
const artistSimilarity = (expected, actual) => {
  const expectedIdentity = normalizeObservation({ artist: expected, title: "" }, aliasIndex).artist;
  const actualIdentity = normalizeObservation({ artist: actual, title: "" }, aliasIndex).artist;
  if (artistsOverlap(expectedIdentity, actualIdentity)) return 1;
  const left = fingerprint(expected);
  const right = fingerprint(actual);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return textSimilarity(left, right);
};
const coverUrl = (uri) => uri ? `https://${uri.replace("%%", "400x400")}` : null;

async function selectForArtist(record) {
  const cacheKey = [...record.normalizedArtist.participants].sort().join("+") || fingerprint(record.artist);
  const existing = yandexCache.artists[cacheKey];
  if (existing?.status === "selected" || (existing?.status === "not-found" && !retryNotFound)) return existing;
  if ((/[?/]/u.test(record.artist) && record.artist !== "25/17") || /\b(?:неизвест|unknown)\b/iu.test(record.artist)) {
    return { status: "not-found", reason: "suspicious-artist-credit", artist: record.artist, retrievedAt: generatedAt };
  }
  const searchUrl = `https://api.music.yandex.net/search?text=${encodeURIComponent(record.artist)}&type=artist&page=0&nocorrect=false`;
  const search = await requestJson(searchUrl);
  const ranked = (search?.result?.artists?.results || [])
    .map((artist) => ({ artist, score: artistSimilarity(record.artist, artist.name) }))
    .sort((left, right) => right.score - left.score);
  const match = ranked[0];
  if (!match || match.score < 0.72 || (ranked[1] && match.score - ranked[1].score < 0.06 && match.score < 0.96)) {
    return { status: "not-found", reason: "artist-match-ambiguous", artist: record.artist, alternatives: ranked.slice(0, 3).map(({artist,score}) => ({id:artist.id,name:artist.name,score})), retrievedAt: generatedAt };
  }
  const [brief, tracksDocument] = await Promise.all([
    requestJson(`https://api.music.yandex.net/artists/${match.artist.id}/brief-info`).catch(() => null),
    requestJson(`https://api.music.yandex.net/artists/${match.artist.id}/tracks?page=0&page-size=40`),
  ]);
  const artist = brief?.result?.artist || match.artist;
  const monthRank = Number(artist.ratings?.month ?? match.artist.ratings?.month) || null;
  const skipTop = monthRank && monthRank <= 20_000 ? 3 : monthRank && monthRank <= 100_000 ? 1 : 0;
  const tracks = tracksDocument?.result?.tracks || [];
  const eligible = tracks.map((track, index) => ({ track, index })).filter(({ track }) => {
    if (!track.available || !track.title || badVersion.test(`${track.title} ${track.version || ""}`)) return false;
    const duration = Number(track.durationMs || 0) / 1000;
    if (duration && (duration < 90 || duration > 600)) return false;
    if (!(track.artists || []).some(({ id }) => String(id) === String(match.artist.id))) return false;
    const credit = (track.artists || []).map(({ name }) => name).join(" & ") || artist.name;
    const identity = identityOf(credit, track.title);
    return !existingMatch(credit, track.title) && !selectedKeys.has(identity.key);
  });
  const choice = eligible.find(({ index }) => index >= skipTop) || eligible[0];
  if (!choice) return { status: "not-found", reason: "no-fresh-track", artist: record.artist, yandexArtistId: String(match.artist.id), retrievedAt: generatedAt };
  const track = choice.track;
  const album = track.albums?.[0] || null;
  const credit = (track.artists || []).map(({ name }) => name).join(" & ") || artist.name;
  const result = {
    status: "selected",
    inputArtist: record.artist,
    artist: credit,
    title: track.title,
    yandexArtistId: String(match.artist.id),
    yandexTrackId: String(track.id),
    popularity: { monthRank, likesCount: Number(artist.likesCount || 0) || null, skippedTopTracks: skipTop, selectedRank: choice.index + 1 },
    releaseYear: Number(album?.year) || null,
    album: album ? {
      title: album.title,
      kind: album.type === "single" || Number(album.trackCount) <= 3 ? "single" : "album",
      year: Number(album.year) || null,
      coverUrl: coverUrl(album.coverUri || track.coverUri),
      sourceUrl: `https://music.yandex.com/album/${album.id}/track/${track.id}`,
      rightsStatus: "contextual-only",
    } : null,
    artistImage: coverUrl(artist.cover?.uri || artist.ogImage) ? {
      url: coverUrl(artist.cover?.uri || artist.ogImage),
      sourceUrl: `https://music.yandex.com/artist/${match.artist.id}`,
      attribution: "Яндекс Музыка",
      rightsStatus: "contextual-only",
    } : null,
    artistContext: {
      country: artist.countries?.join(", ") || null,
      activeSince: artist.initDate || null,
      genres: artist.genres || [],
      description: artist.description?.text || null,
    },
    facts: [
      artist.countries?.length ? { text: `Страна: ${artist.countries.join(", ")}.`, sourceUrl: `https://music.yandex.com/artist/${match.artist.id}` } : null,
      artist.initDate ? { text: `Начало деятельности: ${artist.initDate}.`, sourceUrl: `https://music.yandex.com/artist/${match.artist.id}` } : null,
    ].filter(Boolean),
    sourceUrl: `https://music.yandex.com/album/${album?.id || 0}/track/${track.id}`,
    retrievedAt: generatedAt,
  };
  selectedKeys.add(identityOf(result.artist, result.title).key);
  return result;
}

if (fetchArtists) {
  const pending = [...artistOnly.entries()].filter(([key]) => yandexCache.artists[key]?.status !== "selected"
    && (retryNotFound || yandexCache.artists[key]?.status !== "not-found"));
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < pending.length) {
      const index = cursor++;
      const [key, record] = pending[index];
      try { yandexCache.artists[key] = await selectForArtist(record); }
      catch (error) { yandexCache.artists[key] = { status: "temporary-error", artist: record.artist, error: String(error?.message || error), retrievedAt: generatedAt }; }
      completed += 1;
      if (completed % 10 === 0 || completed === pending.length) {
        yandexCache.generatedAt = new Date().toISOString();
        writeJson(yandexCachePath, yandexCache);
        console.log(`${completed}/${pending.length} artist selections`);
      }
      await wait(pauseMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

const sourceUrl = "https://boosty.to/quizpartynakhate/media/all";
const poolTracks = [];
for (const [key, item] of incomingPairs) {
  const refs = item.refs;
  poolTracks.push({
    id: `quiz-answer-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 12)}`,
    artist: item.artist,
    title: item.title,
    candidateType: "quiz-answer-pair",
    sourceBand: easiestBand(refs),
    language: languageForRefs(refs, item.artist, item.title),
    reviewStatus: refs.some(({ reviewStatus }) => reviewStatus === "verified") ? "verified" : "needs-review",
    sourceName: refs.some(({ format }) => format === "modern") ? "Музыкальный квиз — новый формат" : "Музыкальный квиз — первый формат",
    sourceUrl,
    quizAnswerRefs: refs,
    status: "available",
  });
}
const unresolvedArtists = [];
for (const [key, item] of artistOnly) {
  const selected = yandexCache.artists[key];
  if (selected?.status !== "selected") {
    unresolvedArtists.push({ artist: item.artist, sourceCount: item.refs.length, selection: selected || { status: "not-fetched" }, refs: item.refs });
    continue;
  }
  if (selected.popularity?.monthRank && selected.popularity.monthRank <= 20_000
    && selected.popularity.selectedRank <= 3) {
    unresolvedArtists.push({
      artist: item.artist,
      sourceCount: item.refs.length,
      selection: { ...selected, status: "not-found", reason: "only-top-3-fresh-track" },
      refs: item.refs,
    });
    continue;
  }
  const identity = identityOf(selected.artist, selected.title);
  if (incomingPairs.has(identity.key) || existingMatch(selected.artist, selected.title)) continue;
  const refs = item.refs;
  poolTracks.push({
    id: `quiz-answer-${crypto.createHash("sha1").update(identity.key).digest("hex").slice(0, 12)}`,
    artist: selected.artist,
    title: selected.title,
    candidateType: "artist-seed-yandex",
    sourceBand: easiestBand(refs),
    language: languageForRefs(refs, selected.artist, selected.title),
    reviewStatus: refs.some(({ reviewStatus }) => reviewStatus === "verified") ? "verified" : "needs-review",
    listYear: selected.releaseYear,
    releaseYear: selected.releaseYear,
    album: selected.album,
    artistImage: selected.artistImage,
    artistContext: selected.artistContext,
    facts: selected.facts || [],
    yandexArtistId: selected.yandexArtistId,
    yandexTrackId: selected.yandexTrackId,
    popularity: selected.popularity,
    sourceName: "Яндекс Музыка — треки исполнителя по популярности",
    sourceUrl: selected.sourceUrl,
    quizAnswerRefs: refs,
    status: "available",
  });
}

poolTracks.sort((left, right) => left.artist.localeCompare(right.artist, "ru") || left.title.localeCompare(right.title, "ru"));
const seenPoolKeys = new Set();
const uniquePoolTracks = poolTracks.filter((track) => {
  const key = identityOf(track.artist, track.title).key;
  if (seenPoolKeys.has(key)) return false;
  seenPoolKeys.add(key);
  return true;
});
const pool = {
  version: 1,
  batch: 4,
  generatedAt,
  count: uniquePoolTracks.length,
  sources: [
    { name: "Музыкальные квизы — первый формат", role: "medium-difficulty-seed", answerFile: "results/all-answers.csv" },
    { name: "Музыкальные квизы — новый формат", role: "harder-difficulty-seed", answerFile: "results/new-quizzes/music-answers-final.csv" },
    { name: "Яндекс Музыка", role: "artist-only-track-selection", url: "https://music.yandex.com/" },
  ],
  rules: {
    existingDatabasePairsExcluded: true,
    duplicatePairsExcluded: true,
    legacyDefaultDifficulty: "middle",
    modernDefaultDifficulty: "deep",
    popularArtistTopTracksSkipped: 3,
    popularArtistThresholdYandexMonthRank: 20000,
  },
  tracks: uniquePoolTracks,
};
const report = {
  version: 1,
  generatedAt,
  stats: {
    sourceObservations: observations.length,
    pairObservations: observations.filter(({ title }) => title).length,
    artistOnlyObservations: observations.filter(({ title }) => !title).length,
    existingPairObservations: existingPairs.length,
    uniqueNewPairs: incomingPairs.size,
    uniqueArtistSeeds: artistOnly.size,
    selectedArtistSongs: Object.values(yandexCache.artists).filter(({ status }) => status === "selected").length,
    unresolvedArtistSeeds: unresolvedArtists.length,
    outputTracks: uniquePoolTracks.length,
  },
  unresolvedArtists,
};
writeJson(dataPath("song-pool-4.json"), pool);
writeJson(dataPath("quiz-answer-import-report.json"), report);
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const unresolvedCsv = [
  ["artist", "source_count", "reason", "alternatives"],
  ...unresolvedArtists.map((item) => [
    item.artist,
    item.sourceCount,
    item.selection?.reason || item.selection?.status || "",
    (item.selection?.alternatives || []).map(({ name, artist, title }) => name || [artist, title].filter(Boolean).join(" — ")).join("; "),
  ]),
].map((row) => row.map(csvCell).join(",")).join("\n");
fs.writeFileSync(dataPath("quiz-answer-unresolved-artists.csv"), `\uFEFF${unresolvedCsv}\n`);
console.log(JSON.stringify(report.stats, null, 2));
