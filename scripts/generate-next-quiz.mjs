import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkYouTubeVideo } from "./youtube-playability.mjs";
import { isArtistBlocked, isArtistPrioritized, loadArtistSelectionPolicy } from "./artist-selection-policy.mjs";
import { conflictEntityIdsFor, publicationReport, validatePublicationVerification } from "./publication-verification.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const valueAfter = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const sourcePath = path.join(repoRoot, "data", "quiz-ready-songs.json");
const preflightPath = path.join(repoRoot, "data", "quiz-ready-validation.json");
const outputPath = path.resolve(repoRoot, valueAfter("--output", "data/quiz-release-candidate.json"));
const seed = valueAfter("--seed", new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Yerevan" }));
const generationPolicy = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "quiz-generation-policy.json"), "utf8"));
if (args.has("--allow-used-artists") && args.has("--new-artists-only")) {
  throw new Error("Нельзя одновременно указывать --allow-used-artists и --new-artists-only.");
}
const allowPreviouslyUsedArtists = args.has("--allow-used-artists")
  || (!args.has("--new-artists-only") && generationPolicy.allowPreviouslyUsedArtists === true);
const skipPreflight = args.has("--skip-preflight");
const offline = args.has("--offline");
const refreshYouTube = args.has("--refresh-youtube");
const strictPublication = args.has("--strict-publication");
const goldenOnly = args.has("--golden-only");
const eraTargets = { soviet: 2, "1990s": 4, "2000s": 7, "2010s": 4, "2020s": 3 };
const recognitionTargets = { recognizable: 5, middle: 8, deep: 7 };
const maxPriorityArtists = 2;
const artistSelectionPolicy = loadArtistSelectionPolicy(repoRoot);

const pool = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const goldenReservePath = path.join(repoRoot, "data", "song-golden-reserve.json");
const goldenReserve = fs.existsSync(goldenReservePath)
  ? JSON.parse(fs.readFileSync(goldenReservePath, "utf8"))
  : { songs: [] };
const goldenSongIds = new Set(goldenReserve.songs.map(({ songId }) => songId));
const publicationVerificationPath = path.join(repoRoot, "data", "song-publication-verification.json");
const publicationVerification = fs.existsSync(publicationVerificationPath)
  ? validatePublicationVerification(JSON.parse(fs.readFileSync(publicationVerificationPath, "utf8")))
  : { songs: {} };
const publishedReleaseFiles = fs.readdirSync(path.join(repoRoot, "data"))
  .filter((name) => /^quiz-release-new-rules(?:-\d+)?\.json$/u.test(name));
const publishedSongs = publishedReleaseFiles.flatMap((name) => {
  const release = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", name), "utf8"));
  return release.status === "verified" ? release.tracks || [] : [];
});
const publishedSongIds = new Set(publishedSongs.map((song) => song.songId).filter(Boolean));
const publishedVideoIds = new Set(publishedSongs.map((song) => song.youtube?.videoId).filter(Boolean));
const publishedSongKeys = new Set(publishedSongs.map((song) => `${song.artist}\0${song.title}`.toLocaleLowerCase("ru-RU")));
let preflightSongIds = null;
let preflightPlaybackBySongId = new Map();
if (!skipPreflight) {
  if (!fs.existsSync(preflightPath)) throw new Error("Нет предрелизного отчёта. Сначала запусти npm run preflight:ready.");
  const sourceSha256 = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
  const preflight = JSON.parse(fs.readFileSync(preflightPath, "utf8"));
  if (preflight.source?.sha256 !== sourceSha256) {
    throw new Error("Предрелизный отчёт устарел. Снова запусти npm run preflight:ready.");
  }
  preflightSongIds = new Set(preflight.passed.map(({ songId }) => songId));
  preflightPlaybackBySongId = new Map(preflight.passed.map(({ songId, playback }) => [songId, playback]));
}
const stableRank = (song) => crypto.createHash("sha256")
  .update(`${seed}:${song.songId}:${song.youtube.videoId}`)
  .digest("hex");

const hasArtistOverlap = (song, selected) => selected.some((other) =>
  conflictEntityIdsFor(song, publicationVerification).some((left) =>
    conflictEntityIdsFor(other, publicationVerification).includes(left)));

const candidates = [...goldenReserve.songs, ...pool.songs.filter(({ songId }) => !goldenSongIds.has(songId))]
  .filter((song) => song.readyForQuiz)
  .filter((song) => !publicationVerification.songs[song.songId]?.publishedAt)
  .filter((song) => !publishedSongIds.has(song.songId)
    && !publishedVideoIds.has(song.youtube?.videoId)
    && !publishedSongKeys.has(`${song.artist}\0${song.title}`.toLocaleLowerCase("ru-RU")))
  .filter((song) => !goldenOnly || goldenSongIds.has(song.songId))
  .filter((song) => !isArtistBlocked(song, artistSelectionPolicy))
  .filter((song) => song.reserveTier === "golden" || !preflightSongIds || preflightSongIds.has(song.songId))
  .filter((song) => !strictPublication || publicationReport(song, publicationVerification.songs[song.songId]).passed)
  .filter((song) => allowPreviouslyUsedArtists || song.artistNovelty === "new-artist")
  .filter((song) => eraTargets[song.era] !== undefined)
  .map((song) => {
    const verified = publicationVerification.songs[song.songId];
    return {
      ...song,
      artist: verified?.identity?.artist || song.artist,
      artistAliases: verified?.identity?.artistAliases || song.artistAliases,
      recognizability: verified?.difficulty?.band || song.recognizability,
      optionalMetadata: verified?.identity?.artistForm ? { ...song.optionalMetadata, artistForm: verified.identity.artistForm } : song.optionalMetadata,
    };
  })
  .sort((left, right) => Number(right.reserveTier === "golden") - Number(left.reserveTier === "golden")
    || Number(isArtistPrioritized(right, artistSelectionPolicy))
    - Number(isArtistPrioritized(left, artistSelectionPolicy))
    || stableRank(left).localeCompare(stableRank(right)));

const eras = Object.keys(eraTargets);
const recognitionBands = Object.keys(recognitionTargets);
const bucketKey = (era, band) => `${era}:${band}`;
const candidateBuckets = new Map();
for (const era of eras) {
  for (const band of recognitionBands) {
    candidateBuckets.set(bucketKey(era, band), candidates.filter((song) => song.era === era && song.recognizability === band));
  }
}

const rowOptions = Object.fromEntries(eras.map((era) => {
  const options = [];
  const target = eraTargets[era];
  for (let recognizable = 0; recognizable <= target; recognizable += 1) {
    for (let middle = 0; middle <= target - recognizable; middle += 1) {
      const deep = target - recognizable - middle;
      const counts = { recognizable, middle, deep };
      if (recognitionBands.every((band) => counts[band] <= candidateBuckets.get(bucketKey(era, band)).length)) options.push(counts);
    }
  }
  return [era, options.sort((left, right) => {
    const balanceScore = (counts) => recognitionBands.reduce((sum, band) =>
      sum + Math.abs(counts[band] / target - recognitionTargets[band] / 20), 0);
    return balanceScore(left) - balanceScore(right)
      || recognitionBands.map((band) => left[band]).join("").localeCompare(recognitionBands.map((band) => right[band]).join(""));
  })];
}));

const selectSongsForMatrix = (matrix, rejectedVideoIds) => {
  const remaining = new Map();
  for (const era of eras) {
    for (const band of recognitionBands) remaining.set(bucketKey(era, band), matrix[era][band]);
  }
  const selected = [];
  const visit = () => {
    if (selected.length === 20) return true;
    const choices = [...remaining.entries()]
      .filter(([, count]) => count > 0)
      .map(([key, count]) => {
        const eligible = candidateBuckets.get(key)
          .filter((song) => !rejectedVideoIds.has(song.youtube.videoId))
          .filter((song) => !selected.some((other) => other.songId === song.songId || other.youtube.videoId === song.youtube.videoId))
          .filter((song) => !hasArtistOverlap(song, selected))
          .filter((song) => !isArtistPrioritized(song, artistSelectionPolicy)
            || selected.filter((other) => isArtistPrioritized(other, artistSelectionPolicy)).length < maxPriorityArtists);
        return { key, count, eligible };
      })
      .sort((left, right) => (left.eligible.length - left.count) - (right.eligible.length - right.count)
        || left.eligible.length - right.eligible.length);
    const choice = choices[0];
    if (!choice || choice.eligible.length < choice.count) return false;
    remaining.set(choice.key, choice.count - 1);
    for (const song of choice.eligible) {
      selected.push(song);
      if (visit()) return true;
      selected.pop();
    }
    remaining.set(choice.key, choice.count);
    return false;
  };
  return visit() ? selected : null;
};

const selectExactSongs = (rejectedVideoIds) => {
  const remainingBands = { ...recognitionTargets };
  const matrix = {};
  const allocateRows = (eraIndex) => {
    if (eraIndex === eras.length) {
      if (!recognitionBands.every((band) => remainingBands[band] === 0)) return null;
      return selectSongsForMatrix(matrix, rejectedVideoIds);
    }
    const era = eras[eraIndex];
    for (const option of rowOptions[era]) {
      if (!recognitionBands.every((band) => option[band] <= remainingBands[band])) continue;
      matrix[era] = option;
      for (const band of recognitionBands) remainingBands[band] -= option[band];
      const result = allocateRows(eraIndex + 1);
      if (result) return result;
      for (const band of recognitionBands) remainingBands[band] += option[band];
    }
    delete matrix[era];
    return null;
  };
  const result = allocateRows(0);
  if (!result) throw new Error("Не удалось одновременно выполнить квоты эпох, сложности и уникальности исполнителей.");
  return result;
};

const checkYouTube = async (song) => {
  if (offline) return { status: "not-checked", reason: "offline" };
  const cached = preflightPlaybackBySongId.get(song.songId);
  if (!refreshYouTube && cached?.status === "passed") return { ...cached, reason: "fresh-preflight-cache" };
  const result = await checkYouTubeVideo(song.youtube.videoId);
  if (/^http-(?:408|425|429|5\d\d)$/u.test(result.reason || "") && cached?.status === "passed") {
    return { ...cached, reason: `fresh-preflight-cache-after-${result.reason}` };
  }
  if (/^http-(?:408|425|429|5\d\d)$/u.test(result.reason || "")) {
    throw new Error(`Временная ошибка YouTube ${result.reason}; выпуск не изменён.`);
  }
  return result;
};

const rejectedVideoIds = new Set();
const playbackChecksByVideo = new Map();
let selected;
while (true) {
  selected = selectExactSongs(rejectedVideoIds);
  const unchecked = selected.filter((song) => !playbackChecksByVideo.has(song.youtube.videoId));
  for (let index = 0; index < unchecked.length; index += 5) {
    const batch = unchecked.slice(index, index + 5);
    const checked = await Promise.all(batch.map(async (song) => ({
      song,
      check: await checkYouTube(song),
    })));
    for (const { song, check } of checked) {
      playbackChecksByVideo.set(song.youtube.videoId, { songId: song.songId, videoId: song.youtube.videoId, ...check });
    }
  }
  const failedSongs = selected.filter((song) => playbackChecksByVideo.get(song.youtube.videoId)?.status === "failed");
  if (!failedSongs.length) break;
  for (const song of failedSongs) {
    const check = playbackChecksByVideo.get(song.youtube.videoId);
    console.warn(`Исключено видео: ${song.artist} — ${song.title} (${song.youtube.videoId}): ${check.reason}`);
    rejectedVideoIds.add(song.youtube.videoId);
  }
}
const playbackChecks = [...playbackChecksByVideo.values()];

const ordered = [...selected].sort((left, right) => stableRank({ ...left, songId: `order:${left.songId}` })
  .localeCompare(stableRank({ ...right, songId: `order:${right.songId}` })));
const releaseCandidate = {
  version: 1,
  generatedAt: new Date().toISOString(),
  seed,
  status: "draft",
  policy: {
    trackCount: 20,
    eraTargets,
    recognitionTargets,
    newArtistsOnly: !allowPreviouslyUsedArtists,
    uniqueArtists: true,
    uniqueSongs: true,
    uniqueYouTubeVideos: true,
    preflightRequired: !skipPreflight,
    strictPublication,
    youtubeRefreshRequested: refreshYouTube,
    artistStopListApplied: true,
    priorityArtistPreferenceApplied: true,
    maxPriorityArtists,
    goldenReservePreferred: true,
    clipLoudnessMeasurementRequired: true,
    artistFormReviewRequired: true,
    firstPerformanceReviewRequired: true,
    originalRecordingRequiredForCovers: true,
  },
  validation: {
    passed: true,
    playbackChecks,
    rejectedVideos: [...rejectedVideoIds],
    notes: [
      "Проверка YouTube отсеивает удалённые, возрастные и запрещённые для встраивания ролики.",
      "При обычной сборке используется свежая семидневная проверка, чтобы лимит YouTube 429 не считался поломкой ролика.",
      "В выпуск попадают только карточки, прошедшие актуальный предрелизный отчёт.",
      "Границы фрагментов выбраны эвристикой; перед публикацией остаётся короткое прослушивание.",
      "Перед публикацией громкость каждого фрагмента измеряется и получает индивидуальную коррекцию к общему безопасному уровню.",
      "Форма исполнителя и первое известное исполнение проверяются отдельно; для кавера сохраняются исполнитель и ссылка на оригинал.",
    ],
  },
  stats: {
    eras: Object.fromEntries(Object.keys(eraTargets).map((era) => [era, ordered.filter((song) => song.era === era).length])),
    recognition: Object.fromEntries(Object.keys(recognitionTargets).map((band) => [band, ordered.filter((song) => song.recognizability === band).length])),
    minimumViews: Math.min(...ordered.map((song) => song.youtube.viewCount || 0)),
    goldenReserveSongs: ordered.filter((song) => song.reserveTier === "golden").length,
  },
  tracks: ordered,
};

fs.writeFileSync(outputPath, `${JSON.stringify(releaseCandidate, null, 2)}\n`);
console.log(JSON.stringify({ output: path.relative(repoRoot, outputPath), ...releaseCandidate.stats }, null, 2));
