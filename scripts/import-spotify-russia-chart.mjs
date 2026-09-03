import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = process.argv[2];

if (!sourcePath) {
  throw new Error("Usage: node scripts/import-spotify-russia-chart.mjs <kworb-html>");
}

const html = fs.readFileSync(sourcePath, "utf8");
const poolFiles = ["data/song-pool.json", "data/song-pool-2.json"];
const previousPools = poolFiles.flatMap((file) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8")).tracks,
);
const quizSource = fs.readFileSync(path.join(repoRoot, "app/quiz-data.ts"), "utf8");

const decodeHtml = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&#039;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const transliteration = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

const fingerprint = (value) =>
  decodeHtml(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[а-яё]/g, (letter) => transliteration[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, "");

const pairKey = (artist, title) => `${fingerprint(artist)}::${fingerprint(title)}`;
const knownPairs = new Set(previousPools.map(({ artist, title }) => pairKey(artist, title)));
const knownArtists = new Set(previousPools.map(({ artist }) => fingerprint(artist)));

for (const match of quizSource.matchAll(/artist:\s*"([^"]+)"[\s\S]{0,600}?title:\s*"([^"]+)"/g)) {
  knownPairs.add(pairKey(match[1], match[2]));
  knownArtists.add(fingerprint(match[1]));
}

const number = (value) => Number(value.replaceAll(",", ""));
const parsed = [];

for (const rowMatch of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
  const cells = [...rowMatch[1].matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  if (cells.length !== 7) continue;
  const trackMatch = cells[0].match(/<a href="\.\.\/track\/([^."]+)\.html">([\s\S]*?)<\/a>/);
  const artistIdMatch = cells[0].match(/<a href="\.\.\/artist\/([^."]+)\.html">/);
  const artistHtml = cells[0].split(/\s+-\s+<a href="\.\.\/track\//)[0];
  if (!trackMatch || !artistIdMatch || !artistHtml) continue;
  const artist = decodeHtml(artistHtml.replace(/<[^>]+>/g, "")).trim();
  const title = decodeHtml(trackMatch[2].replace(/<[^>]+>/g, "")).trim();
  const numberOneMatch = cells[4].match(/\(x(\d+)\)/);
  parsed.push({
    artist,
    title,
    spotifyArtistId: artistIdMatch[1],
    spotifyTrackId: trackMatch[1],
    appearancesDays: number(cells[1]),
    top10Days: number(cells[2]),
    peakPosition: Number(cells[3]),
    numberOneDays: Number(numberOneMatch?.[1] || 0),
    peakStreams: number(cells[5]),
    totalStreams: number(cells[6]),
  });
}

if (parsed.length < 2500) {
  throw new Error(`Parsed only ${parsed.length} chart rows; source format may have changed`);
}

const deduplicated = new Map();
for (const row of parsed) {
  const key = pairKey(row.artist, row.title);
  const previous = deduplicated.get(key);
  if (!previous || row.totalStreams > previous.totalStreams) deduplicated.set(key, row);
}

const rows = [...deduplicated.values()];
const maxDays = Math.max(...rows.map((row) => row.appearancesDays));
const maxStreams = Math.max(...rows.map((row) => row.totalStreams));

const score = (row) => {
  const top10Share = row.top10Days / row.appearancesDays;
  const numberOneShare = row.numberOneDays / row.appearancesDays;
  const peakStrength = (201 - row.peakPosition) / 200;
  const value =
    0.4 * (Math.log1p(row.appearancesDays) / Math.log1p(maxDays)) +
    0.25 * (Math.log1p(row.totalStreams) / Math.log1p(maxStreams)) +
    0.2 * top10Share +
    0.1 * peakStrength +
    0.05 * numberOneShare;
  return Number((100 * value).toFixed(2));
};

const hasCyrillic = (value) => /[а-яё]/i.test(value);
const localArtistHints = [
  "kizaru", "bigbabytape", "skryptonite", "morgenshtern", "slava marlow",
  "markul", "miyagi", "andypanda", "jony", "niletto", "rakhim", "feduk",
  "pharaoh", "face", "mot", "maxkorzh", "cream soda", "hammali", "navai",
  "artik", "asti", "zivert", "klavakoka", "egorkreed", "marygu", "ramil",
  "lsp", "t-fest", "matrang", "og buda", "sqwozbab", "dora", "mayot",
  "thomasmraz", "dose", "saluk", "jeembo", "blago white", "macan",
].map(fingerprint);

const catalog = rows
  .map((row) => {
    const normalizedArtist = fingerprint(row.artist);
    const isLocalCandidate =
      hasCyrillic(`${row.artist} ${row.title}`) ||
      knownArtists.has(normalizedArtist) ||
      localArtistHints.some((hint) => normalizedArtist.includes(hint) || hint.includes(normalizedArtist));
    return {
      ...row,
      chartScore: score(row),
      isLocalCandidate,
      alreadyInSongPool: knownPairs.has(pairKey(row.artist, row.title)),
    };
  })
  .sort((a, b) => b.chartScore - a.chartScore || b.totalStreams - a.totalStreams);

const blockedVersionPattern = /\b(?:skit|intro|outro|instrumental|sped up|slowed|remix|live)\b/i;
const candidates = catalog.filter(
  (row) => row.isLocalCandidate && !row.alreadyInSongPool && !blockedVersionPattern.test(row.title),
);

const scoreBands = {
  recognizable: candidates.filter((row) => row.chartScore >= 65),
  middle: candidates.filter((row) => row.chartScore >= 48 && row.chartScore < 65),
  deep: candidates.filter((row) => row.chartScore < 48),
};
const targets = { recognizable: 250, middle: 450, deep: 300 };
const selected = [];
const selectedKeys = new Set();
const perArtist = new Map();

const takeFromBand = (band, target) => {
  for (const row of band) {
    if (selected.length >= 1000 || target <= 0) break;
    const artistKey = fingerprint(row.artist);
    if ((perArtist.get(artistKey) ?? 0) >= 12) continue;
    const key = pairKey(row.artist, row.title);
    if (selectedKeys.has(key)) continue;
    selected.push(row);
    selectedKeys.add(key);
    perArtist.set(artistKey, (perArtist.get(artistKey) ?? 0) + 1);
    target -= 1;
  }
};

for (const band of ["recognizable", "middle", "deep"]) {
  takeFromBand(scoreBands[band], targets[band]);
}
takeFromBand(candidates, 1000 - selected.length);

if (selected.length !== 1000) {
  throw new Error(`Could select only ${selected.length} fresh local tracks`);
}

const selectedWithIds = selected.map((row, index) => {
  const sourceBand = row.chartScore >= 65 ? "recognizable" : row.chartScore >= 48 ? "middle" : "deep";
  return {
    id: `pool-${String(index + 2001).padStart(4, "0")}`,
    artist: row.artist,
    title: row.title,
    candidateType: "chart-derived",
    sourceBand,
    chartScore: row.chartScore,
    appearancesDays: row.appearancesDays,
    top10Days: row.top10Days,
    numberOneDays: row.numberOneDays,
    peakPosition: row.peakPosition,
    totalStreams: row.totalStreams,
    spotifyTrackId: row.spotifyTrackId,
    sourceUrl: "https://kworb.net/spotify/country/ru_daily_totals.html",
  };
});

const chartDatabase = {
  version: 1,
  generatedAt: "2026-09-03",
  source: {
    chart: "Spotify Daily Chart — Russia",
    market: "RU",
    periodStart: "2020-07-15",
    periodEnd: "2022-04-07",
    granularity: "daily",
    aggregator: "Kworb",
    url: "https://kworb.net/spotify/country/ru_daily_totals.html",
  },
  count: catalog.length,
  localCandidateCount: catalog.filter((row) => row.isLocalCandidate).length,
  freshLocalCandidateCount: candidates.length,
  scoring: {
    scale: "0–100",
    formula: "40% log(days) + 25% log(total streams) + 20% top-10 share + 10% peak strength + 5% number-one share",
    note: "Daily and weekly aggregates are not combined, so the same chart exposure is not counted twice.",
  },
  tracks: catalog,
};

const thirdPool = {
  version: 1,
  batch: 3,
  generatedAt: "2026-09-03",
  count: selectedWithIds.length,
  idRange: ["pool-2001", "pool-3000"],
  builtAgainstQuizCount: 10,
  notes: [
    "Третья тысяча кандидатов получена из агрегата дневного Spotify-чарта России; повторы попаданий повышают вес песни.",
    "Это не готовые карточки: перед квизом нужно проверить написание, форму исполнителя, официальный ролик и границы фрагмента.",
    "Песни из первых двух пулов и quiz-data.ts исключены; исполнители могут повторяться, максимум 12 песен на нормализованного исполнителя.",
    "Период чарта — 2020-07-15…2022-04-07, поэтому этот пакет дополняет, а не заменяет ориентированную на 2000-е основную базу.",
  ],
  selection: {
    source: "Spotify Daily Chart — Russia via Kworb",
    scoreBands: Object.fromEntries(
      Object.entries(scoreBands).map(([band, entries]) => [band, selected.filter((row) => entries.includes(row)).length]),
    ),
    maxTracksPerNormalizedArtist: 12,
    uniqueNormalizedArtists: perArtist.size,
    method: "Стратифицированный отбор по чартовому весу; затем заполнение до 1000 с ограничением на исполнителя.",
  },
  sources: [chartDatabase.source],
  tracks: selectedWithIds,
};

fs.writeFileSync(
  path.join(repoRoot, "data/chart-songs-spotify-ru.json"),
  `${JSON.stringify(chartDatabase, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(repoRoot, "data/song-pool-3.json"),
  `${JSON.stringify(thirdPool, null, 2)}\n`,
);

console.log(JSON.stringify({
  parsedRows: parsed.length,
  uniqueChartRows: catalog.length,
  localCandidates: chartDatabase.localCandidateCount,
  freshLocalCandidates: candidates.length,
  selected: selectedWithIds.length,
  selectedArtists: perArtist.size,
  selectedBands: thirdPool.selection.scoreBands,
}, null, 2));
