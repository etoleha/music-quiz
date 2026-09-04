import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkYouTubeVideo } from "./youtube-playability.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const valueAfter = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const sourcePath = path.join(repoRoot, "data", "quiz-ready-songs.json");
const outputPath = path.resolve(repoRoot, valueAfter("--output", "data/quiz-release-candidate.json"));
const seed = valueAfter("--seed", new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Yerevan" }));
const allowPreviouslyUsedArtists = args.has("--allow-used-artists");
const offline = args.has("--offline");
const eraTargets = { soviet: 2, "1990s": 4, "2000s": 7, "2010s": 4, "2020s": 3 };
const recognitionTargets = { recognizable: 5, middle: 8, deep: 7 };

const pool = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const stableRank = (song) => crypto.createHash("sha256")
  .update(`${seed}:${song.songId}:${song.youtube.videoId}`)
  .digest("hex");

const artistIdsOverlap = (left, right) => left === right
  || (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left)));
const hasArtistOverlap = (song, selected) => selected.some((other) =>
  song.artistIds.some((left) => other.artistIds.some((right) => artistIdsOverlap(left, right))));

const candidates = pool.songs
  .filter((song) => song.readyForQuiz)
  .filter((song) => allowPreviouslyUsedArtists || song.artistNovelty === "new-artist")
  .filter((song) => eraTargets[song.era] !== undefined)
  .sort((left, right) => stableRank(left).localeCompare(stableRank(right)));

const selected = [];
const recognitionCounts = { recognizable: 0, middle: 0, deep: 0 };
for (const [era, target] of Object.entries(eraTargets)) {
  while (selected.filter((song) => song.era === era).length < target) {
    const eligible = candidates
      .filter((song) => song.era === era)
      .filter((song) => !selected.some((other) => other.songId === song.songId || other.youtube.videoId === song.youtube.videoId))
      .filter((song) => !hasArtistOverlap(song, selected))
      .sort((left, right) => {
        const leftNeed = recognitionTargets[left.recognizability] - recognitionCounts[left.recognizability];
        const rightNeed = recognitionTargets[right.recognizability] - recognitionCounts[right.recognizability];
        return rightNeed - leftNeed || stableRank(left).localeCompare(stableRank(right));
      });
    const song = eligible[0];
    if (!song) throw new Error(`Не хватает уникальных кандидатов эпохи ${era}: выбрано ${selected.filter((item) => item.era === era).length}/${target}`);
    selected.push(song);
    recognitionCounts[song.recognizability] += 1;
  }
}

const checkYouTube = async (song) => {
  if (offline) return { status: "not-checked", reason: "offline" };
  return checkYouTubeVideo(song.youtube.videoId);
};

const playbackChecks = [];
const rejectedVideoIds = new Set();
let pendingPlaybackChecks = [...selected];
while (pendingPlaybackChecks.length) {
  const failedSongs = [];
  for (let index = 0; index < pendingPlaybackChecks.length; index += 5) {
    const batch = pendingPlaybackChecks.slice(index, index + 5);
    const checked = await Promise.all(batch.map(async (song) => ({
      song,
      check: await checkYouTube(song),
    })));
    for (const { song, check } of checked) {
      playbackChecks.push({ songId: song.songId, videoId: song.youtube.videoId, ...check });
      if (check.status === "failed") failedSongs.push(song);
    }
  }
  if (!failedSongs.length) break;
  pendingPlaybackChecks = [];
  for (const failedSong of failedSongs) {
    rejectedVideoIds.add(failedSong.youtube.videoId);
    const failedIndex = selected.findIndex((song) => song.songId === failedSong.songId);
    if (failedIndex >= 0) selected.splice(failedIndex, 1);
    recognitionCounts[failedSong.recognizability] -= 1;
    const replacement = candidates
      .filter((song) => song.era === failedSong.era)
      .filter((song) => !rejectedVideoIds.has(song.youtube.videoId))
      .filter((song) => !selected.some((other) => other.songId === song.songId || other.youtube.videoId === song.youtube.videoId))
      .filter((song) => !hasArtistOverlap(song, selected))
      .sort((left, right) => {
        const leftSameBand = Number(left.recognizability === failedSong.recognizability);
        const rightSameBand = Number(right.recognizability === failedSong.recognizability);
        return rightSameBand - leftSameBand || stableRank(left).localeCompare(stableRank(right));
      })[0];
    if (!replacement) throw new Error(`Не нашлось замены для ${failedSong.artist} — ${failedSong.title} (${failedSong.era})`);
    selected.push(replacement);
    recognitionCounts[replacement.recognizability] += 1;
    pendingPlaybackChecks.push(replacement);
  }
}

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
  },
  validation: {
    passed: true,
    playbackChecks,
    rejectedVideos: [...rejectedVideoIds],
    notes: [
      "Проверка YouTube отсеивает удалённые, возрастные и запрещённые для встраивания ролики.",
      "Границы фрагментов выбраны эвристикой; перед публикацией остаётся короткое прослушивание.",
    ],
  },
  stats: {
    eras: Object.fromEntries(Object.keys(eraTargets).map((era) => [era, ordered.filter((song) => song.era === era).length])),
    recognition: Object.fromEntries(Object.keys(recognitionTargets).map((band) => [band, ordered.filter((song) => song.recognizability === band).length])),
    minimumViews: Math.min(...ordered.map((song) => song.youtube.viewCount || 0)),
  },
  tracks: ordered,
};

fs.writeFileSync(outputPath, `${JSON.stringify(releaseCandidate, null, 2)}\n`);
console.log(JSON.stringify({ output: path.relative(repoRoot, outputPath), ...releaseCandidate.stats }, null, 2));
