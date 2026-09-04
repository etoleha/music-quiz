import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  artistsOverlap,
  buildAliasIndex,
  decodeHtml,
  fingerprint,
  normalizeObservation,
  textSimilarity,
} from "./chart-normalization.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const generatedAt = new Date().toISOString();
const observedAt = process.env.CHART_SNAPSHOT_DATE || generatedAt.slice(0, 10);
const offlineDirectory = process.env.CHART_OFFLINE_DIR || null;
const rebuildOnly = process.env.CHART_REBUILD_ONLY === "1";

const aliases = JSON.parse(fs.readFileSync(dataPath("artist-aliases.json"), "utf8"));
const aliasIndex = buildAliasIndex(aliases);
const sourceRegistry = JSON.parse(fs.readFileSync(dataPath("chart-sources.json"), "utf8"));
const spotify = JSON.parse(fs.readFileSync(dataPath("chart-songs-spotify-ru.json"), "utf8"));
const europaPlus = JSON.parse(fs.readFileSync(dataPath("chart-songs-europa-plus.json"), "utf8"));
const topHitPath = dataPath("chart-songs-tophit-monthly.json");
const topHitIndex = fs.existsSync(topHitPath)
  ? JSON.parse(fs.readFileSync(topHitPath, "utf8"))
  : {};
const topHitArchive = topHitIndex.archive
  ? JSON.parse(zlib.gunzipSync(fs.readFileSync(dataPath(topHitIndex.archive))).toString("utf8"))
  : null;
const topHit = {
  ...topHitIndex,
  tracks: topHitIndex.tracks || topHitArchive?.tracks || (topHitIndex.parts || []).flatMap((file) =>
    JSON.parse(fs.readFileSync(dataPath(file), "utf8")).tracks || []),
};
const observationsPath = dataPath("chart-observations.json");
const observations = fs.existsSync(observationsPath)
  ? JSON.parse(fs.readFileSync(observationsPath, "utf8"))
  : { version: 1, snapshots: [] };

const weeklyKey = (dateString) => {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const snapshotKeyFor = (source, periodEnd) => {
  if (source.cadence === "weekly") {
    if (source.id === "youtube-ru-weekly") return periodEnd;
    return weeklyKey(observedAt);
  }
  return observedAt;
};

const automaticSources = sourceRegistry.sources.filter(
  (source) => source.status === "monitored" && source.automatic,
);

const fetchText = async (url) => {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "music-quiz-chart-monitor/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const sourceInput = async (source, offlineName) => {
  if (offlineDirectory) {
    return fs.readFileSync(path.join(offlineDirectory, offlineName), "utf8");
  }
  return await fetchText(source.url);
};

const stripTags = (value) => decodeHtml(value.replace(/<[^>]+>/g, "")).trim();

const tableBody = (html, tableId) => {
  const table = html.match(new RegExp(`<table[^>]*id="${tableId}"[\\s\\S]*?<tbody>([\\s\\S]*?)<\\/tbody>`));
  if (!table) throw new Error(`Table #${tableId} was not found`);
  return table[1];
};

const cellsFromRow = (row) =>
  [...row.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => stripTags(match[1]));

const splitArtistTitle = (value) => {
  const separator = value.indexOf(" - ");
  if (separator < 1) throw new Error(`Cannot split artist and title: ${value}`);
  return { artist: value.slice(0, separator).trim(), title: value.slice(separator + 3).trim() };
};

const parseSimpleChart = (html) => {
  const entries = [];
  for (const match of tableBody(html, "simpletable").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = cellsFromRow(match[1]);
    if (cells.length < 3) continue;
    const rank = Number(cells[0]);
    if (!Number.isInteger(rank)) continue;
    entries.push({ rank, ...splitArtistTitle(cells[2]) });
  }
  return entries;
};

const parseYoutubeChart = (html) => {
  const entries = [];
  for (const match of tableBody(html, "weeklytable").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = cellsFromRow(match[1]);
    if (cells.length < 8) continue;
    const rank = Number(cells[0]);
    if (!Number.isInteger(rank)) continue;
    entries.push({
      rank,
      ...splitArtistTitle(cells[2]),
      reportedWeeks: Number(cells[3]),
      reportedPeak: Number(cells[4]),
      reportedNumberOneWeeks: Number(cells[5].match(/x(\d+)/)?.[1] || 0),
      streams: Number(cells[6].replaceAll(",", "")),
    });
  }
  const periodEnd = html.match(/Week ending\s+(\d{4}\/\d{2}\/\d{2})/)?.[1]?.replaceAll("/", "-");
  return { entries, periodEnd: periodEnd || observedAt };
};

const parseAppleChart = (jsonText) => {
  const payload = JSON.parse(jsonText);
  return payload.feed.results.map((result, index) => ({
    rank: index + 1,
    artist: result.artistName,
    title: result.name,
    platformId: result.id,
    url: result.url,
    contentAdvisoryRating: result.contentAdvisoryRating || null,
  }));
};

const monitoredInputs = {
  "youtube-ru-weekly": { offlineName: "youtube-ru.html", parser: parseYoutubeChart },
  "shazam-ru": { offlineName: "shazam-ru.html", parser: (html) => ({ entries: parseSimpleChart(html), periodEnd: observedAt }) },
  "apple-music-ru": { offlineName: "apple-music-ru.json", parser: (json) => ({ entries: parseAppleChart(json), periodEnd: observedAt }) },
  "deezer-ru": { offlineName: "deezer-ru.html", parser: (html) => ({ entries: parseSimpleChart(html), periodEnd: observedAt }) },
};

const fetched = [];
const failed = [];
for (const source of rebuildOnly ? [] : automaticSources) {
  const input = monitoredInputs[source.id];
  if (!input) continue;
  try {
    const raw = await sourceInput(source, input.offlineName);
    const parsed = input.parser(raw);
    if (parsed.entries.length < 20) throw new Error(`only ${parsed.entries.length} rows parsed`);
    const hash = crypto
      .createHash("sha256")
      .update(parsed.entries.map(({ rank, artist, title }) => `${rank}|${artist}|${title}`).join("\n"))
      .digest("hex");
    const snapshotKey = snapshotKeyFor(source, parsed.periodEnd);
    const previousIndex = observations.snapshots.findIndex(
      (snapshot) => snapshot.sourceId === source.id
        && (snapshot.snapshotKey === snapshotKey
          || (!snapshot.snapshotKey && snapshot.observedAt === observedAt)),
    );
    if (previousIndex < 0) {
      const snapshot = {
        sourceId: source.id,
        snapshotKey,
        observedAt,
        periodEnd: parsed.periodEnd,
        hash,
        rowCount: parsed.entries.length,
        entries: parsed.entries,
      };
      observations.snapshots.push(snapshot);
      fetched.push({ sourceId: source.id, status: "added", rows: parsed.entries.length, periodEnd: parsed.periodEnd });
    } else {
      const previous = observations.snapshots[previousIndex];
      const status = previous.hash === hash ? "unchanged" : "updated";
      observations.snapshots[previousIndex] = {
        sourceId: source.id,
        snapshotKey,
        observedAt,
        periodEnd: parsed.periodEnd,
        hash,
        rowCount: parsed.entries.length,
        entries: parsed.entries,
      };
      fetched.push({ sourceId: source.id, status, rows: parsed.entries.length, periodEnd: parsed.periodEnd });
    }
  } catch (error) {
    failed.push({ sourceId: source.id, error: error.message });
  }
}

if (!rebuildOnly && fetched.length === 0) {
  throw new Error(`All monitored sources failed: ${failed.map(({ sourceId, error }) => `${sourceId}: ${error}`).join("; ")}`);
}

if (!rebuildOnly) {
  observations.generatedAt = generatedAt;
  observations.lastRun = { generatedAt, fetched, failed };
  observations.snapshots.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.sourceId.localeCompare(b.sourceId));
  fs.writeFileSync(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);
}

const tracks = [];
const exactTitleIndex = new Map();
const externalIdIndex = new Map();
let nextTrackId = 1;

const externalIdKey = (namespace, value) => `${namespace}:${fingerprint(value)}`;

const normalizedExternalIds = (externalIds = {}) => Object.fromEntries(
  Object.entries(externalIds)
    .map(([namespace, values]) => [namespace, [...new Set((values || []).filter(Boolean).map(String))]])
    .filter(([, values]) => values.length),
);

const attachExternalIds = (track, externalIds = {}) => {
  track.externalIds ||= {};
  for (const [namespace, values] of Object.entries(normalizedExternalIds(externalIds))) {
    track.externalIds[namespace] ||= [];
    for (const value of values) {
      if (!track.externalIds[namespace].includes(value)) track.externalIds[namespace].push(value);
      externalIdIndex.set(externalIdKey(namespace, value), track);
    }
    track.externalIds[namespace].sort((left, right) => left.localeCompare(right));
  }
};

const addIndex = (track) => {
  if (!exactTitleIndex.has(track.normalizedTitle)) exactTitleIndex.set(track.normalizedTitle, []);
  exactTitleIndex.get(track.normalizedTitle).push(track);
};

const findTrack = (normalized, externalIds = {}) => {
  const identifierMatches = new Set();
  for (const [namespace, values] of Object.entries(normalizedExternalIds(externalIds))) {
    for (const value of values) {
      const match = externalIdIndex.get(externalIdKey(namespace, value));
      if (match) identifierMatches.add(match);
    }
  }
  if (identifierMatches.size === 1) return [...identifierMatches][0];

  const exact = exactTitleIndex.get(normalized.titleKey) || [];
  const exactArtist = exact.find((track) => artistsOverlap(track.normalizedArtist, normalized.artist));
  if (exactArtist) return exactArtist;

  let best = null;
  for (const track of tracks) {
    if (!artistsOverlap(track.normalizedArtist, normalized.artist)) continue;
    const similarity = textSimilarity(track.normalizedTitle, normalized.titleKey);
    if (similarity >= 0.94 && (!best || similarity > best.similarity)) best = { track, similarity };
  }
  return best?.track || null;
};

const createOrResolveTrack = (entry, externalIds = {}) => {
  const normalized = normalizeObservation(entry, aliasIndex);
  let track = findTrack(normalized, externalIds);
  if (!track) {
    track = {
      id: `chart-${String(nextTrackId).padStart(5, "0")}`,
      artist: entry.artist || "Не указан",
      title: normalized.cleanTitle || entry.title,
      artistAliases: [],
      titleAliases: [],
      normalizedArtist: normalized.artist,
      normalizedTitle: normalized.titleKey,
      externalIds: {},
      explicit: false,
      sources: {},
    };
    nextTrackId += 1;
    tracks.push(track);
    addIndex(track);
  }
  if (entry.artist && !track.artistAliases.includes(entry.artist)) track.artistAliases.push(entry.artist);
  if (entry.title && !track.titleAliases.includes(entry.title)) track.titleAliases.push(entry.title);
  if (!/[а-яё]/iu.test(track.artist) && /[а-яё]/iu.test(entry.artist || "")) track.artist = entry.artist;
  if (!/[а-яё]/iu.test(track.title) && /[а-яё]/iu.test(normalized.cleanTitle)) track.title = normalized.cleanTitle;
  if (fingerprint(entry.contentAdvisoryRating).startsWith("explic")) track.explicit = true;
  attachExternalIds(track, externalIds);
  return track;
};

const mergeSourceStats = (track, sourceId, values) => {
  const stats = track.sources[sourceId] || {
    observations: 0,
    appearances: 0,
    rawPoints: 0,
    bestRank: null,
    firstSeen: null,
    lastSeen: null,
  };
  stats.observations += values.observations ?? 1;
  stats.appearances += values.appearances ?? 1;
  stats.rawPoints += values.rawPoints ?? 0;
  if (values.rank) stats.bestRank = stats.bestRank ? Math.min(stats.bestRank, values.rank) : values.rank;
  if (values.firstSeen && (!stats.firstSeen || values.firstSeen < stats.firstSeen)) stats.firstSeen = values.firstSeen;
  if (values.lastSeen && (!stats.lastSeen || values.lastSeen > stats.lastSeen)) stats.lastSeen = values.lastSeen;
  for (const [key, value] of Object.entries(values.extra || {})) {
    if (value == null) continue;
    if (Array.isArray(value)) stats[key] = [...new Set([...(stats[key] || []), ...value])].sort();
    else if (key.startsWith("max")) stats[key] = Math.max(stats[key] || 0, value);
    else if (key.startsWith("min")) stats[key] = stats[key] == null ? value : Math.min(stats[key], value);
    else stats[key] = value;
  }
  track.sources[sourceId] = stats;
};

for (const entry of spotify.tracks) {
  const track = createOrResolveTrack(entry, { spotify: [entry.spotifyTrackId] });
  mergeSourceStats(track, "spotify-ru-daily-history", {
    observations: 1,
    appearances: entry.appearancesDays,
    rawPoints: entry.appearancesDays + 2 * entry.top10Days + 4 * entry.numberOneDays,
    rank: entry.peakPosition,
    firstSeen: spotify.source.periodStart,
    lastSeen: spotify.source.periodEnd,
    extra: {
      totalStreams: entry.totalStreams,
      top10Days: entry.top10Days,
      numberOneDays: entry.numberOneDays,
      platformId: entry.spotifyTrackId,
    },
  });
}

for (const entry of europaPlus.tracks) {
  if (!entry.artist) continue;
  const track = createOrResolveTrack(entry);
  mergeSourceStats(track, "europa-plus-annual", {
    observations: entry.annualAppearances,
    appearances: entry.annualAppearances,
    rawPoints: entry.annualAppearanceWeight * 20,
    rank: entry.bestAnnualPosition,
    firstSeen: String(Math.min(...entry.chartYears.map(({ year }) => year))),
    lastSeen: String(Math.max(...entry.chartYears.map(({ year }) => year))),
    extra: {
      annualAppearances: entry.annualAppearances,
      totalWeeklyAppearances: entry.totalWeeklyAppearances,
    },
  });
}

for (const entry of topHit.tracks) {
  const track = createOrResolveTrack(entry, {
    tophit: [entry.topHitTrackId],
    isrc: [entry.matchableIsrc],
  });
  mergeSourceStats(track, "tophit-ru-monthly-history", {
    observations: 1,
    appearances: entry.appearancesMonths,
    rawPoints: entry.chartPoints,
    rank: entry.bestPosition,
    firstSeen: entry.firstMonth,
    lastSeen: entry.lastMonth,
    extra: {
      top10Months: entry.top10Months,
      numberOneMonths: entry.numberOneMonths,
      topHitTrackIds: [entry.topHitTrackId].filter(Boolean),
      isrcs: entry.reportedIsrcs,
      matchableIsrcs: [entry.matchableIsrc].filter(Boolean),
      trackUrls: entry.trackUrls,
      releaseDates: entry.releaseDates,
      languageNames: entry.languageNames,
      languageCodes: entry.languageCodes,
      languageFlagCodes: entry.languageFlagCodes,
      languageStatus: entry.languageStatus,
      genres: entry.genres,
      rightsHolders: entry.rightsHolders,
    },
  });
}

for (const snapshot of observations.snapshots) {
  const chartSize = snapshot.entries.length;
  for (const entry of snapshot.entries) {
    const track = createOrResolveTrack(entry, entry.platformId ? { [snapshot.sourceId]: [entry.platformId] } : {});
    const percentilePoints = ((chartSize + 1 - entry.rank) / chartSize) * 100;
    mergeSourceStats(track, snapshot.sourceId, {
      appearances: 1,
      rawPoints: percentilePoints,
      rank: entry.rank,
      firstSeen: snapshot.periodEnd,
      lastSeen: snapshot.periodEnd,
      extra: {
        latestRank: entry.rank,
        latestPeriod: snapshot.periodEnd,
        maxReportedWeeks: entry.reportedWeeks,
        minReportedPeak: entry.reportedPeak,
        maxReportedNumberOneWeeks: entry.reportedNumberOneWeeks,
        latestStreams: entry.streams,
        platformId: entry.platformId,
        url: entry.url,
      },
    });
  }
}

const sourceMaxima = {};
for (const track of tracks) {
  for (const [sourceId, stats] of Object.entries(track.sources)) {
    sourceMaxima[sourceId] = Math.max(sourceMaxima[sourceId] || 0, stats.rawPoints);
  }
}

for (const track of tracks) {
  let combinedScore = 0;
  for (const [sourceId, stats] of Object.entries(track.sources)) {
    const maximum = sourceMaxima[sourceId];
    stats.sourceScore = maximum > 0
      ? Number((100 * Math.log1p(stats.rawPoints) / Math.log1p(maximum)).toFixed(2))
      : 0;
    stats.rawPoints = Number(stats.rawPoints.toFixed(3));
    combinedScore += stats.sourceScore;
  }
  track.sourceCount = Object.keys(track.sources).length;
  track.combinedScore = Number(combinedScore.toFixed(2));
  track.artistAliases.sort((a, b) => a.localeCompare(b, "ru"));
  track.titleAliases.sort((a, b) => a.localeCompare(b, "ru"));
  track.quizEligible = !track.explicit;
}

tracks.sort((a, b) => b.combinedScore - a.combinedScore || b.sourceCount - a.sourceCount || a.artist.localeCompare(b.artist, "ru"));

const potentialArtistAliases = [];
const byTitle = new Map();
for (const track of tracks) {
  if (!byTitle.has(track.normalizedTitle)) byTitle.set(track.normalizedTitle, []);
  byTitle.get(track.normalizedTitle).push(track);
}
for (const sameTitleTracks of byTitle.values()) {
  if (sameTitleTracks.length < 2) continue;
  for (let i = 0; i < sameTitleTracks.length; i += 1) {
    for (let j = i + 1; j < sameTitleTracks.length; j += 1) {
      const left = sameTitleTracks[i];
      const right = sameTitleTracks[j];
      const similarity = textSimilarity(left.normalizedArtist.primary, right.normalizedArtist.primary);
      if (similarity >= 0.72) {
        potentialArtistAliases.push({
          title: left.title,
          leftArtist: left.artist,
          rightArtist: right.artist,
          similarity: Number(similarity.toFixed(3)),
        });
      }
    }
  }
}

const stableTracks = [...tracks].sort((a, b) => a.id.localeCompare(b.id));
const catalogArchiveName = "chart-catalog.json.gz";
fs.writeFileSync(dataPath(catalogArchiveName), zlib.gzipSync(Buffer.from(JSON.stringify({
  version: 1,
  generatedAt,
  trackCount: stableTracks.length,
  tracks: stableTracks,
})), { level: 9 }));

const catalog = {
  version: 1,
  generatedAt,
  trackCount: tracks.length,
  archive: catalogArchiveName,
  sourceCount: sourceRegistry.sources.filter(({ status }) => status === "imported" || status === "monitored").length,
  snapshotCount: observations.snapshots.length,
  scoring: {
    withinSource: "Each repeated snapshot appearance adds percentile rank points from 1 to 100.",
    historical: "Historical aggregates retain their own repeat counts and are converted to raw source points.",
    acrossSources: "Each source is log-normalized to 0–100; normalized source scores are then added.",
  },
};

const review = {
  version: 1,
  generatedAt,
  potentialArtistAliasCount: potentialArtistAliases.length,
  potentialArtistAliases: potentialArtistAliases.slice(0, 500),
};

fs.writeFileSync(dataPath("chart-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
fs.writeFileSync(dataPath("chart-merge-review.json"), `${JSON.stringify(review, null, 2)}\n`);

console.log(JSON.stringify({
  fetched,
  failed,
  snapshots: observations.snapshots.length,
  tracks: catalog.trackCount,
  multiSourceTracks: tracks.filter(({ sourceCount }) => sourceCount > 1).length,
  reviewAliases: potentialArtistAliases.length,
  topHitTracks: topHit.tracks.length,
  topHitCatalogTracks: tracks.filter(({ sources }) => sources["tophit-ru-monthly-history"]).length,
  topHitMultiSourceTracks: tracks.filter(({ sources, sourceCount }) => sources["tophit-ru-monthly-history"] && sourceCount > 1).length,
}, null, 2));
