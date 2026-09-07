import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { conflictEntityIdsFor, goldenReserveReport, validatePublicationVerification } from "./publication-verification.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const reserve = JSON.parse(fs.readFileSync(dataPath("song-golden-reserve.json"), "utf8"));
const verification = validatePublicationVerification(JSON.parse(fs.readFileSync(dataPath("song-publication-verification.json"), "utf8")));
const feedbackPath = dataPath("quiz-difficulty-feedback.json");
const feedback = fs.existsSync(feedbackPath) ? JSON.parse(fs.readFileSync(feedbackPath, "utf8")) : null;
const normalizeArtistKey = (value) => value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, " ").trim();
const artistDifficulty = new Map((feedback?.difficulty?.artists || []).map((item) => [item.artistKey, item]));
const baseDifficulty = { recognizable: 25, middle: 55, deep: 80 };
const difficultyBand = (song) => {
  const evidence = artistDifficulty.get(normalizeArtistKey(song.artist));
  if (!evidence?.attempts) return song.recognizability;
  const confidence = Math.max(0, Math.min(1, Number(evidence.confidence) || 0));
  const adjusted = baseDifficulty[song.recognizability] * (1 - confidence) + Number(evidence.difficulty) * confidence;
  return adjusted >= 68 ? "deep" : adjusted >= 40 ? "middle" : "recognizable";
};
const seed = process.argv[2] || "golden-five-2026-09";
const eraTargets = { "1990s": 4, "2000s": 5, "2010s": 6, "2020s": 5 };
const definitions = [
  { number: 26, level: "выше среднего", recognition: { recognizable: 4, middle: 8, deep: 8 }, rap: 1 },
  { number: 27, level: "сложный", recognition: { recognizable: 4, middle: 7, deep: 9 }, rap: 1 },
  { number: 28, level: "сложный", recognition: { recognizable: 3, middle: 8, deep: 9 }, rap: 1 },
  { number: 29, level: "очень сложный", recognition: { recognizable: 3, middle: 7, deep: 10 }, rap: 2 },
  { number: 30, level: "очень сложный", recognition: { recognizable: 2, middle: 7, deep: 11 }, rap: 1 },
];

const roman = (number) => {
  const values = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let rest = number;
  let result = "";
  for (const [value, glyph] of values) while (rest >= value) {
    result += glyph;
    rest -= value;
  }
  return result;
};

const rank = (song, quizNumber) => crypto.createHash("sha256")
  .update(`${seed}:${quizNumber}:${song.songId}:${song.youtube.videoId}`)
  .digest("hex");
const isRap = (song) => /rap/iu.test(song.goldenVerification?.catalog?.genre || "");
const usedSongIds = new Set();
const usedVideos = new Set();

const rowOptions = (target, recognitionTargets, candidates) => {
  const bands = Object.keys(recognitionTargets);
  const options = [];
  for (let recognizable = 0; recognizable <= target; recognizable += 1) {
    for (let middle = 0; middle <= target - recognizable; middle += 1) {
      const counts = { recognizable, middle, deep: target - recognizable - middle };
      if (bands.every((band) => counts[band] <= candidates.filter((song) => song.recognizability === band).length)) options.push(counts);
    }
  }
  return options.sort((left, right) => bands.reduce((sum, band) => sum + Math.abs(left[band] / target - recognitionTargets[band] / 20), 0)
    - bands.reduce((sum, band) => sum + Math.abs(right[band] / target - recognitionTargets[band] / 20), 0));
};

const selectQuiz = (definition) => {
  const eligible = reserve.songs
    .filter((song) => !usedSongIds.has(song.songId) && !usedVideos.has(song.youtube.videoId))
    .filter((song) => goldenReserveReport(song, verification.songs[song.songId]).passed)
    .map((song) => ({ ...song, catalogRecognizability: song.recognizability, recognizability: difficultyBand(song) }))
    .sort((left, right) => rank(left, definition.number).localeCompare(rank(right, definition.number)));
  const eras = Object.keys(eraTargets);
  const bands = Object.keys(definition.recognition);
  const rows = Object.fromEntries(eras.map((era) => [era, rowOptions(
    eraTargets[era],
    definition.recognition,
    eligible.filter((song) => song.era === era),
  )]));
  const remainingBands = { ...definition.recognition };
  const matrix = {};

  const chooseSongs = () => {
    const buckets = new Map();
    for (const era of eras) for (const band of bands) {
      buckets.set(`${era}:${band}`, eligible.filter((song) => song.era === era && song.recognizability === band));
    }
    const remaining = new Map();
    for (const era of eras) for (const band of bands) remaining.set(`${era}:${band}`, matrix[era][band]);
    const selected = [];
    const entities = new Set();
    let rapCount = 0;
    const visit = () => {
      if (selected.length === 20) return rapCount === definition.rap;
      const choices = [...remaining.entries()]
        .filter(([, count]) => count > 0)
        .map(([key, count]) => ({
          key,
          count,
          songs: buckets.get(key).filter((song) => !selected.some((item) => item.songId === song.songId)
            && !conflictEntityIdsFor(song, verification).some((entity) => entities.has(entity))
            && (rapCount < definition.rap || !isRap(song))),
        }))
        .sort((left, right) => (left.songs.length - left.count) - (right.songs.length - right.count));
      const choice = choices[0];
      if (!choice || choice.songs.length < choice.count) return false;
      remaining.set(choice.key, choice.count - 1);
      for (const song of choice.songs) {
        const songEntities = conflictEntityIdsFor(song, verification);
        selected.push(song);
        for (const entity of songEntities) entities.add(entity);
        if (isRap(song)) rapCount += 1;
        if (visit()) return true;
        if (isRap(song)) rapCount -= 1;
        selected.pop();
        for (const entity of songEntities) entities.delete(entity);
      }
      remaining.set(choice.key, choice.count);
      return false;
    };
    return visit() ? selected : null;
  };

  const allocate = (index) => {
    if (index === eras.length) {
      if (!bands.every((band) => remainingBands[band] === 0)) return null;
      return chooseSongs();
    }
    const era = eras[index];
    for (const option of rows[era]) {
      if (!bands.every((band) => option[band] <= remainingBands[band])) continue;
      matrix[era] = option;
      for (const band of bands) remainingBands[band] -= option[band];
      const selected = allocate(index + 1);
      if (selected) return selected;
      for (const band of bands) remainingBands[band] += option[band];
    }
    delete matrix[era];
    return null;
  };

  const tracks = allocate(0);
  if (!tracks) throw new Error(`Не удалось собрать квиз ${definition.number} с заданными квотами.`);
  for (const song of tracks) {
    usedSongIds.add(song.songId);
    usedVideos.add(song.youtube.videoId);
  }
  return tracks.sort((left, right) => rank({ ...left, songId: `order:${left.songId}` }, definition.number)
    .localeCompare(rank({ ...right, songId: `order:${right.songId}` }, definition.number)));
};

const generatedAt = new Date().toISOString();
const outputs = [];
for (const definition of definitions) {
  const tracks = selectQuiz(definition);
  const output = {
    version: 1,
    generatedAt,
    status: "draft-preverified",
    quiz: { id: `hard-${definition.number}`, title: `Квиз ${roman(definition.number)}`, level: definition.level, published: null },
    policy: {
      source: "song-golden-reserve.json",
      trackCount: 20,
      eraTargets,
      recognitionTargets: definition.recognition,
      rapTracksSelected: definition.rap,
      uniqueSongsAcrossBatch: true,
      uniqueYouTubeVideosAcrossBatch: true,
      uniqueArtistEntitiesWithinQuiz: true,
      publicationRequiredChecks: ["youtube-refresh", "fragment-listening", "relationship-review", "credits-and-ost-review"],
      answerDifficultyFeedbackApplied: artistDifficulty.size > 0,
      difficultyFeedbackFetchedAt: feedback?.fetchedAt || null,
    },
    stats: {
      eras: Object.fromEntries(Object.keys(eraTargets).map((era) => [era, tracks.filter((song) => song.era === era).length])),
      recognition: Object.fromEntries(Object.keys(definition.recognition).map((band) => [band, tracks.filter((song) => song.recognizability === band).length])),
      rapTracks: tracks.filter(isRap).length,
    },
    tracks,
  };
  const file = `quiz-release-draft-${definition.number}.json`;
  fs.writeFileSync(dataPath(file), `${JSON.stringify(output, null, 2)}\n`);
  outputs.push({ file, quiz: output.quiz, stats: output.stats });
}

console.log(JSON.stringify({ generatedAt, quizzes: outputs, totalSongs: usedSongIds.size, totalVideos: usedVideos.size }, null, 2));
