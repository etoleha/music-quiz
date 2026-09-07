import fs from "node:fs";
import path from "node:path";
import { checkYouTubeVideo } from "./youtube-playability.mjs";

const root = path.resolve(import.meta.dirname, "..");
const releaseArgument = process.argv[2] || "data/quiz-release-new-rules.json";
const releasePath = path.resolve(root, releaseArgument);
const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
const legacySources = [
  fs.readFileSync(path.join(root, "app", "quiz-data.ts"), "utf8"),
  fs.readFileSync(path.join(root, "app", "quiz-data-extra.ts"), "utf8"),
];
const historicalSource = legacySources.join("\n");
const knownReleases = fs.readdirSync(path.join(root, "data"))
  .filter((file) => /^quiz-release.+\.json$/u.test(file) && !/-validation\.json$/u.test(file) && path.join(root, "data", file) !== releasePath)
  .flatMap((file) => JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8")).tracks || []);
const knownPairs = new Set(knownReleases.map((song) => `${song.artist}\u0000${song.title}`.toLocaleLowerCase("ru-RU")));
const knownVideos = new Set(knownReleases.map((song) => song.youtube?.videoId).filter(Boolean));

const duplicates = release.tracks.flatMap((song) => {
  const pairNeedle = `"${song.artist}", "${song.title}"`;
  const videoNeedle = `"${song.youtube.videoId}"`;
  const pairKey = `${song.artist}\u0000${song.title}`.toLocaleLowerCase("ru-RU");
  return [(knownPairs.has(pairKey) || historicalSource.includes(pairNeedle)) && `${song.songId}:pair`, (knownVideos.has(song.youtube.videoId) || historicalSource.includes(videoNeedle)) && `${song.songId}:video`].filter(Boolean);
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
const reportPath = releasePath.replace(/\.json$/u, "-validation.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (failed.length) throw new Error(`Unplayable videos: ${JSON.stringify(failed)}`);
console.log(`release validation passed: ${playback.length} videos`);
