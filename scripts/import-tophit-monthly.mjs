import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { fingerprint } from "./chart-normalization.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaultOutput = path.join(repoRoot, "data", "chart-songs-tophit-monthly.json");
const isrcSuffix = /([A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5})$/i;

export const canonicalIsrc = (value = "") => {
  const match = String(value).trim().match(isrcSuffix);
  return match ? match[1].toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
};

export const extractIsrc = (row) => {
  const direct = canonicalIsrc(row.isrc);
  if (direct) return { value: direct, source: "isrc" };
  const recovered = canonicalIsrc(row.rights_holder);
  return recovered ? { value: recovered, source: "rights_holder_suffix" } : null;
};

const cleanRightsHolder = (value = "", extracted) => {
  const text = String(value).trim();
  if (extracted?.source !== "rights_holder_suffix") return text;
  return text.slice(0, text.length - text.match(isrcSuffix)[1].length).trim();
};

export const parseCsv = (text) => {
  const table = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      table.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    table.push(row);
  }
  const headers = (table.shift() || []).map((header) => header.replace(/^\uFEFF/, ""));
  return table
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
};

const rowsFromInput = (inputPath) => {
  const text = fs.readFileSync(inputPath, "utf8");
  if (path.extname(inputPath).toLowerCase() === ".csv") {
    return { rows: parseCsv(text), exportedAt: null };
  }
  const payload = JSON.parse(text);
  if (Array.isArray(payload)) return { rows: payload, exportedAt: null };
  if (Array.isArray(payload.rows)) return { rows: payload.rows, exportedAt: payload.exported_at ?? null };
  if (Array.isArray(payload.charts)) {
    return {
      rows: payload.charts.flatMap((chart) => chart.rows || []),
      exportedAt: payload.exported_at ?? null,
    };
  }
  throw new Error("Ожидался CSV или JSON-экспорт TopHit с rows/charts");
};

const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const sortedUnique = (values) => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "ru"));
const normalizeLanguageName = (value = "") => {
  const normalized = String(value).trim().toLowerCase();
  if (["russian", "русский", "ru"].includes(normalized)) return "russian";
  if (["english", "английский", "en"].includes(normalized)) return "english";
  return normalized || null;
};

const trackKeyFor = (row, extracted) => {
  const topHitTrackId = String(row.track_id || "").trim();
  if (topHitTrackId) return `tophit:${topHitTrackId}`;
  if (extracted?.value) return `isrc:${extracted.value}`;
  return `text:${fingerprint(row.artist)}:${fingerprint(row.title)}`;
};

const emptyTrack = (row, extracted) => {
  const topHitTrackId = String(row.track_id || "").trim() || null;
  const key = trackKeyFor(row, extracted);
  return {
    topHitTrackId,
    fallbackKey: topHitTrackId ? null : key,
    artist: String(row.artist || "").trim() || null,
    title: String(row.title || "").trim(),
    artistAliases: [],
    titleAliases: [],
    genres: [],
    rightsHolders: [],
    reportedIsrcs: [],
    isrcSources: [],
    matchableIsrc: null,
    isrcStatus: "missing",
    trackUrls: [],
    releaseDates: [],
    languageNames: [],
    languageCodes: [],
    languageFlagCodes: [],
    monthlyPositions: {},
    _key: key,
  };
};

const loadExisting = (outputPath) => {
  if (!fs.existsSync(outputPath)) return new Map();
  const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const archive = payload.archive
    ? JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve(path.dirname(outputPath), payload.archive))).toString("utf8"))
    : null;
  const existingTracks = payload.tracks || archive?.tracks || (payload.parts || []).flatMap((file) =>
    JSON.parse(fs.readFileSync(path.resolve(path.dirname(outputPath), file), "utf8")).tracks || []);
  return new Map(existingTracks.map((track) => {
    const fallbackKey = track.fallbackKey || `text:${fingerprint(track.artist)}:${fingerprint(track.title)}`;
    const key = track.topHitTrackId ? `tophit:${track.topHitTrackId}` : fallbackKey;
    return [
    key,
    {
      ...track,
      fallbackKey: track.topHitTrackId ? null : fallbackKey,
      _key: key,
      isrcSources: track.isrcSources || [],
      languageNames: track.languageNames || [],
      languageCodes: track.languageCodes || [],
      languageFlagCodes: track.languageFlagCodes || [],
    },
    ];
  }));
};

export const aggregateRows = (rows, existingTracks = new Map()) => {
  const tracks = new Map(existingTracks);
  let directIsrcRows = 0;
  let recoveredIsrcRows = 0;
  let skippedRows = 0;

  for (const row of rows) {
    const artist = String(row.artist || "").trim();
    const title = String(row.title || "").trim();
    const month = String(row.chart_month || "").trim();
    const position = numberOrNull(row.position);
    if (!title || !/^\d{4}-\d{2}$/.test(month) || !position) {
      skippedRows += 1;
      continue;
    }

    const extracted = extractIsrc(row);
    if (extracted?.source === "isrc") directIsrcRows += 1;
    if (extracted?.source === "rights_holder_suffix") recoveredIsrcRows += 1;
    const key = trackKeyFor(row, extracted);
    const track = tracks.get(key) || emptyTrack(row, extracted);
    track.artistAliases.push(artist);
    track.titleAliases.push(title);
    track.genres.push(...String(row.genres || "").split("|").map((value) => value.trim()));
    track.rightsHolders.push(cleanRightsHolder(row.rights_holder, extracted));
    if (extracted) {
      track.reportedIsrcs.push(extracted.value);
      track.isrcSources.push(extracted.source);
    }
    track.trackUrls.push(String(row.track_url || "").trim());
    track.releaseDates.push(String(row.release_date || "").trim());
    track.languageNames.push(String(row.tophit_language || row.language || "").trim());
    track.languageCodes.push(normalizeLanguageName(row.tophit_language || row.language));
    track.languageFlagCodes.push(String(row.tophit_language_flag || row.language_flag || "").trim().toLowerCase());
    track.monthlyPositions[month] = position;
    tracks.set(key, track);
  }

  const isrcTrackIds = new Map();
  for (const track of tracks.values()) {
    track.reportedIsrcs = sortedUnique(track.reportedIsrcs);
    for (const isrc of track.reportedIsrcs) {
      if (!isrcTrackIds.has(isrc)) isrcTrackIds.set(isrc, new Set());
      isrcTrackIds.get(isrc).add(track.topHitTrackId || track._key);
    }
  }

  for (const track of tracks.values()) {
    track.artistAliases = sortedUnique(track.artistAliases);
    track.titleAliases = sortedUnique(track.titleAliases);
    track.genres = sortedUnique(track.genres);
    track.rightsHolders = sortedUnique(track.rightsHolders);
    track.isrcSources = sortedUnique(track.isrcSources);
    track.trackUrls = sortedUnique(track.trackUrls);
    track.releaseDates = sortedUnique(track.releaseDates);
    track.languageNames = sortedUnique(track.languageNames);
    track.languageCodes = sortedUnique(track.languageCodes);
    track.languageFlagCodes = sortedUnique(track.languageFlagCodes);
    track.languageStatus = track.languageCodes.length > 1 ? "conflicting" : track.languageCodes.length === 1 ? "unique" : "missing";
    track.monthlyPositions = Object.fromEntries(Object.entries(track.monthlyPositions).sort(([left], [right]) => left.localeCompare(right)));
    const positions = Object.values(track.monthlyPositions);
    const months = Object.keys(track.monthlyPositions);
    const conflicting = track.reportedIsrcs.length > 1;
    const colliding = track.reportedIsrcs.some((isrc) => isrcTrackIds.get(isrc).size > 1);
    track.isrcStatus = conflicting ? "conflicting" : colliding ? "collision" : track.reportedIsrcs.length ? "unique" : "missing";
    track.matchableIsrc = track.isrcStatus === "unique" ? track.reportedIsrcs[0] : null;
    track.appearancesMonths = positions.length;
    track.top10Months = positions.filter((position) => position <= 10).length;
    track.numberOneMonths = positions.filter((position) => position === 1).length;
    track.bestPosition = Math.min(...positions);
    track.firstMonth = months[0];
    track.lastMonth = months.at(-1);
    track.chartPoints = positions.reduce((sum, position) => sum + Math.max(1, 101 - position), 0);
    delete track._key;
  }

  const stableTracks = [...tracks.values()].sort((left, right) =>
    Number(left.topHitTrackId || Number.MAX_SAFE_INTEGER) - Number(right.topHitTrackId || Number.MAX_SAFE_INTEGER)
    || (left.artist || "").localeCompare(right.artist || "", "ru")
    || left.title.localeCompare(right.title, "ru"));
  const collisionIsrcs = [...isrcTrackIds.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([isrc, ids]) => ({ isrc, topHitTrackIds: [...ids].sort((left, right) => Number(left) - Number(right)) }))
    .sort((left, right) => right.topHitTrackIds.length - left.topHitTrackIds.length || left.isrc.localeCompare(right.isrc));

  return {
    tracks: stableTracks,
    stats: {
      inputRows: rows.length,
      storedChartRows: stableTracks.reduce((sum, track) => sum + track.appearancesMonths, 0),
      skippedRows,
      directIsrcRows,
      recoveredIsrcRows,
      trackCount: stableTracks.length,
      trackIdCount: stableTracks.filter((track) => track.topHitTrackId).length,
      matchableIsrcTrackCount: stableTracks.filter((track) => track.matchableIsrc).length,
      collisionIsrcCount: collisionIsrcs.length,
      collisionTrackCount: stableTracks.filter((track) => track.isrcStatus === "collision").length,
      collisionIsrcs,
    },
  };
};

const run = () => {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultOutput;
  if (!inputPath) throw new Error("Использование: node scripts/import-tophit-monthly.mjs <export.csv|backup.json> [output.json]");
  const input = rowsFromInput(path.resolve(inputPath));
  const existing = loadExisting(outputPath);
  const { tracks, stats } = aggregateRows(input.rows, existing);
  const months = tracks.flatMap((track) => Object.keys(track.monthlyPositions));
  const archiveName = `${path.basename(outputPath)}.gz`;
  const archivePayload = JSON.stringify({
    version: 1,
    generatedAt: input.exportedAt || null,
    trackCount: tracks.length,
    tracks,
  });
  fs.writeFileSync(
    path.join(path.dirname(outputPath), archiveName),
    zlib.gzipSync(Buffer.from(archivePayload), { level: 9 }),
  );

  const payload = {
    version: 1,
    generatedAt: input.exportedAt || new Date().toISOString(),
    source: {
      id: "tophit-ru-monthly-history",
      name: "TopHit — Top Radio Hits Russia Monthly",
      chart: "Top Radio Hits Russia Monthly",
      cadence: "monthly",
      periodStart: months.sort()[0] || null,
      periodEnd: months.sort().at(-1) || null,
      url: "https://tophit.com/chart/top/radio/hits/ru/monthly",
      importedFile: path.basename(inputPath),
    },
    rowCount: stats.storedChartRows,
    trackCount: stats.trackCount,
    archive: archiveName,
    isrcQuality: {
      directRows: stats.directIsrcRows,
      recoveredFromRightsHolderRows: stats.recoveredIsrcRows,
      matchableTrackCount: stats.matchableIsrcTrackCount,
      collisionCodeCount: stats.collisionIsrcCount,
      collisionTrackCount: stats.collisionTrackCount,
      rule: "ISRC is matchable only when it maps to exactly one TopHit track_id; colliding codes are retained but never auto-merged.",
    },
    isrcCollisions: stats.collisionIsrcs,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    output: path.relative(repoRoot, outputPath),
    period: `${payload.source.periodStart}…${payload.source.periodEnd}`,
    ...stats,
    collisionIsrcs: stats.collisionIsrcs.slice(0, 10),
  }, null, 2));
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
