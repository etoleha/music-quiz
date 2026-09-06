import fs from "node:fs";
import path from "node:path";
import { checkYouTubeVideo } from "./youtube-playability.mjs";

const root = path.resolve(import.meta.dirname, "..");
const releasePath = path.join(root, "data", "quiz-release-new-rules.json");
const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
const legacySources = [
  fs.readFileSync(path.join(root, "app", "quiz-data.ts"), "utf8"),
  fs.readFileSync(path.join(root, "app", "quiz-data-extra.ts"), "utf8"),
];
const historicalSource = legacySources.join("\n");

const duplicates = release.tracks.flatMap((song) => {
  const pairNeedle = `"${song.artist}", "${song.title}"`;
  const videoNeedle = `"${song.youtube.videoId}"`;
  return [historicalSource.includes(pairNeedle) && `${song.songId}:pair`, historicalSource.includes(videoNeedle) && `${song.songId}:video`].filter(Boolean);
});
if (duplicates.length) throw new Error(`Already published: ${duplicates.join(", ")}`);

const playback = [];
for (let index = 0; index < release.tracks.length; index += 5) {
  const batch = release.tracks.slice(index, index + 5);
  playback.push(...await Promise.all(batch.map(async (song) => ({
    songId: song.songId,
    videoId: song.youtube.videoId,
    ...await checkYouTubeVideo(song.youtube.videoId),
  }))));
}
const failed = playback.filter((item) => item.status !== "passed");
const report = { version: 1, checkedAt: new Date().toISOString(), releaseId: release.quiz.id, duplicateCheck: "passed", playback, passed: failed.length === 0 };
fs.writeFileSync(path.join(root, "data", "quiz-release-new-rules-validation.json"), `${JSON.stringify(report, null, 2)}\n`);
if (failed.length) throw new Error(`Unplayable videos: ${JSON.stringify(failed)}`);
console.log(`release validation passed: ${playback.length} videos`);
