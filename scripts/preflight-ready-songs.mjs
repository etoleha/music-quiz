import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkYouTubeVideo } from "./youtube-playability.mjs";
import { preflightPolicy, validateReadySong } from "./ready-song-preflight.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const args = new Set(process.argv.slice(2));
const refresh = args.has("--refresh");
const offline = args.has("--offline");
const requestConcurrency = Math.max(1, Number(process.env.YOUTUBE_PREFLIGHT_CONCURRENCY || 3));
const requestPauseMs = Math.max(0, Number(process.env.YOUTUBE_PREFLIGHT_PAUSE_MS || 500));
const sourcePath = dataPath("quiz-ready-songs.json");
const reportPath = dataPath("quiz-ready-validation.json");
const cachePath = dataPath("youtube-playability-cache.json");
const sourceBytes = fs.readFileSync(sourcePath);
const sourceSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
const pool = JSON.parse(sourceBytes.toString("utf8"));
const now = Date.now();
const ttlMs = 7 * 24 * 60 * 60 * 1000;
const cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
  : { version: 1, videos: {} };

const rows = pool.songs.map((song) => ({ song, ...validateReadySong(song) }));
const staticClean = rows.filter(({ blockers }) => !blockers.length);
let checkedNow = 0;
let cachedChecks = 0;
let transientFailures = 0;

const isFresh = (entry) => entry?.checkedAt && now - Date.parse(entry.checkedAt) < ttlMs;
const isTransient = (reason = "") => /(?:http-(?:408|425|429|5\d\d)|fetch failed|timeout|timed out|aborted|network)/iu.test(reason);
const saveCache = () => fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);

for (let index = 0; index < staticClean.length; index += requestConcurrency) {
  const batch = staticClean.slice(index, index + requestConcurrency);
  let networkChecksInBatch = 0;
  await Promise.all(batch.map(async (row) => {
    const videoId = row.song.youtube.videoId;
    let playback = cache.videos[videoId];
    if (isFresh(playback) && !refresh) {
      cachedChecks += 1;
    } else if (offline) {
      playback = null;
    } else {
      const result = await checkYouTubeVideo(videoId);
      networkChecksInBatch += 1;
      checkedNow += 1;
      if (result.status === "failed" && isTransient(result.reason)) {
        transientFailures += 1;
        playback = null;
        delete cache.videos[videoId];
      } else {
        playback = { ...result, checkedAt: new Date().toISOString() };
        cache.videos[videoId] = playback;
      }
    }
    row.playback = playback;
    if (!playback) row.blockers.push({ code: "youtube-not-checked", message: "Нет свежей проверки YouTube." });
    else if (playback.status !== "passed") row.blockers.push({ code: "youtube-unplayable", message: `YouTube: ${playback.reason}.` });
  }));
  if (!offline && (index + batch.length) % 40 < requestConcurrency) {
    saveCache();
    console.log(`Предрелизная проверка: ${Math.min(index + batch.length, staticClean.length)}/${staticClean.length}`);
  }
  if (!offline && networkChecksInBatch && index + batch.length < staticClean.length && requestPauseMs) {
    await new Promise((resolve) => setTimeout(resolve, requestPauseMs));
  }
}

if (!offline) saveCache();
if (transientFailures > 0 && (checkedNow < 20 || transientFailures / checkedNow > 0.2)) {
  throw new Error(`Проверка YouTube нестабильна: ${transientFailures}/${checkedNow} временных ошибок. Отчёт не перезаписан.`);
}

const passed = rows.filter(({ blockers }) => !blockers.length);
const quarantined = rows.filter(({ blockers }) => blockers.length);
const issueCounts = {};
for (const { blockers } of quarantined) {
  for (const { code } of blockers) issueCounts[code] = (issueCounts[code] || 0) + 1;
}
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: { file: "quiz-ready-songs.json", sha256: sourceSha256 },
  policy: { ...preflightPolicy, youtubeCacheTtlDays: 7 },
  stats: {
    total: rows.length,
    passed: passed.length,
    quarantined: quarantined.length,
    checkedNow,
    cachedChecks,
    issueCounts,
    passedByEra: Object.fromEntries(Object.keys(preflightPolicy.eraRanges)
      .map((era) => [era, passed.filter(({ song }) => song.era === era).length])),
  },
  passed: passed.map(({ song, warnings, playback }) => ({
    songId: song.songId,
    artist: song.artist,
    title: song.title,
    warnings,
    playback,
  })),
  quarantined: quarantined.map(({ song, blockers, warnings, playback }) => ({
    songId: song.songId,
    artist: song.artist,
    title: song.title,
    blockers,
    warnings,
    playback: playback || null,
  })),
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.stats, null, 2));
