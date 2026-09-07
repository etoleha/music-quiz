import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceUrl = process.env.QUIZ_STATS_URL || "https://quiz.lamtyugin.com/api/stats";
const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`Не удалось получить статистику: HTTP ${response.status}`);
const payload = await response.json();
if (!payload?.difficulty?.policy || !Array.isArray(payload.difficulty.artists)) {
  throw new Error("Сервер ещё не отдаёт калибровку сложности.");
}
const output = {
  version: 1,
  fetchedAt: new Date().toISOString(),
  sourceUrl,
  difficulty: payload.difficulty,
};
const outputPath = path.join(repoRoot, "data", "quiz-difficulty-feedback.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, tracks: output.difficulty.tracks.length, artists: output.difficulty.artists.length }, null, 2));
