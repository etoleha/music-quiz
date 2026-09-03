import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceDirectory = process.argv[2];

if (!sourceDirectory) {
  throw new Error("Usage: node scripts/import-europa-plus-charts.mjs <year-json-directory>");
}

const transliteration = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

const decodeHtml = (value = "") =>
  (value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&#039;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const fingerprint = (value = "") =>
  decodeHtml(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[а-яё]/g, (letter) => transliteration[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, "");

const pairKey = (artist, title) => `${fingerprint(artist)}::${fingerprint(title)}`;
const previousPools = ["data/song-pool.json", "data/song-pool-2.json", "data/song-pool-3.json"]
  .flatMap((file) => JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8")).tracks);
const knownPairs = new Set(previousPools.map(({ artist, title }) => pairKey(artist, title)));
const knownArtists = new Set(previousPools.map(({ artist }) => fingerprint(artist)));
const artistsByTitle = new Map();

for (const { artist, title } of previousPools) {
  const titleKey = fingerprint(title);
  if (!artistsByTitle.has(titleKey)) artistsByTitle.set(titleKey, new Set());
  artistsByTitle.get(titleKey).add(artist);
}

const files = fs.readdirSync(sourceDirectory)
  .filter((file) => /^\d{4}\.json$/.test(file))
  .sort();
const yearlyCharts = files.map((file) => {
  const payload = JSON.parse(fs.readFileSync(path.join(sourceDirectory, file), "utf8"));
  return payload.data.chart;
});

const rawEntries = [];
for (const chart of yearlyCharts) {
  const chartLength = chart.items.length;
  for (const item of chart.items) {
    let artist = decodeHtml(item.song.singers_names ?? "").trim();
    let artistResolution = "source";
    if (!artist) {
      const matches = artistsByTitle.get(fingerprint(item.song.name));
      if (matches?.size === 1) {
        artist = [...matches][0];
        artistResolution = "unique-title-match";
      } else {
        artistResolution = "missing";
      }
    }
    const title = decodeHtml(item.song.name).trim();
    const normalizedRank = chartLength === 1 ? 1 : 1 - (item.position - 1) / (chartLength - 1);
    rawEntries.push({
      artist: artist || null,
      title,
      artistResolution,
      europaPlusSongId: item.song.id,
      year: chart.year,
      annualPosition: item.position,
      chartLength,
      weeklyAppearances: item.count_weeks,
      annualAppearanceWeight: Number((1 + 4 * Math.max(0, normalizedRank)).toFixed(3)),
      previewUrl: item.song.hook || null,
      youtubeId: item.video_url_embed?.match(/embed\/([^?]+)/)?.[1] ?? null,
    });
  }
}

const grouped = new Map();
for (const entry of rawEntries) {
  const key = entry.artist ? pairKey(entry.artist, entry.title) : `europa-plus:${entry.europaPlusSongId}`;
  if (!grouped.has(key)) {
    grouped.set(key, {
      artist: entry.artist,
      title: entry.title,
      artistResolution: entry.artistResolution,
      europaPlusSongId: entry.europaPlusSongId,
      annualAppearances: 0,
      annualAppearanceWeight: 0,
      totalWeeklyAppearances: 0,
      bestAnnualPosition: entry.annualPosition,
      chartYears: [],
      previewUrl: entry.previewUrl,
      youtubeId: entry.youtubeId,
    });
  }
  const record = grouped.get(key);
  record.annualAppearances += 1;
  record.annualAppearanceWeight += entry.annualAppearanceWeight;
  record.totalWeeklyAppearances += entry.weeklyAppearances;
  record.bestAnnualPosition = Math.min(record.bestAnnualPosition, entry.annualPosition);
  record.chartYears.push({
    year: entry.year,
    position: entry.annualPosition,
    chartLength: entry.chartLength,
    weeklyAppearances: entry.weeklyAppearances,
  });
}

const tracks = [...grouped.values()]
  .map((record) => ({
    ...record,
    annualAppearanceWeight: Number(record.annualAppearanceWeight.toFixed(3)),
    isLocalCandidate:
      /[а-яё]/i.test(`${record.artist ?? ""} ${record.title}`) ||
      knownArtists.has(fingerprint(record.artist)),
    alreadyInSongPool: record.artist ? knownPairs.has(pairKey(record.artist, record.title)) : false,
    sourceUrl: `https://europaplus.ru/year-chart?year=${record.chartYears[0].year}`,
  }))
  .sort((a, b) =>
    b.annualAppearanceWeight - a.annualAppearanceWeight ||
    b.totalWeeklyAppearances - a.totalWeeklyAppearances ||
    (a.artist ?? "").localeCompare(b.artist ?? "", "ru"),
  );

const result = {
  version: 1,
  generatedAt: "2026-09-03",
  source: {
    chart: "ЕвроХит Топ-40 — итоги года",
    publisher: "Европа Плюс",
    periodStart: String(yearlyCharts[0].year),
    periodEnd: String(yearlyCharts.at(-1).year),
    granularity: "annual",
    url: "https://europaplus.ru/year-chart",
  },
  rawAppearanceCount: rawEntries.length,
  count: tracks.length,
  localCandidateCount: tracks.filter((track) => track.isLocalCandidate).length,
  missingArtistCount: tracks.filter((track) => !track.artist).length,
  scoring: {
    formula: "For each annual appearance: 1 persistence point + up to 4 position-strength points, normalized by that year's chart length; repeat years are summed.",
    note: "Raw year, rank, list length and weekly-appearance fields are retained for rescoring.",
  },
  tracks,
};

fs.writeFileSync(
  path.join(repoRoot, "data/chart-songs-europa-plus.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);

console.log(JSON.stringify({
  years: yearlyCharts.length,
  rawAppearances: rawEntries.length,
  uniqueTracks: tracks.length,
  localCandidates: result.localCandidateCount,
  missingArtists: result.missingArtistCount,
}, null, 2));
