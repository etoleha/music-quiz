import type { DatabaseSync } from "node:sqlite";

export function applyBadFragmentScoreRule(database: DatabaseSync, attemptId: string, trackKey: string) {
  const answer = database.prepare(`SELECT id, artist_point AS artistPoint,
    title_point AS titlePoint, load_failed AS loadFailed
    FROM attempt_answers WHERE attempt_id = ? AND track_key = ?`).get(attemptId, trackKey) as {
      id: number;
      artistPoint: number;
      titlePoint: number;
      loadFailed: number;
    } | undefined;
  if (!answer) throw new Error("Ответ не найден");
  const autoAnnulled = !answer.loadFailed && answer.artistPoint + answer.titlePoint < 2;
  if (autoAnnulled) database.prepare("UPDATE attempt_answers SET load_failed = 1 WHERE id = ?").run(answer.id);
  return { loadFailed: Boolean(answer.loadFailed || autoAnnulled), autoAnnulled };
}

export function restoreAutoAnnulledAnswer(database: DatabaseSync, attemptId: string, trackKey: string) {
  database.prepare("UPDATE attempt_answers SET load_failed = 0 WHERE attempt_id = ? AND track_key = ?")
    .run(attemptId, trackKey);
}

export function attemptTotals(database: DatabaseSync, attemptId: string) {
  return database.prepare(`SELECT
    COALESCE(SUM(CASE WHEN load_failed = 0 THEN artist_point + title_point ELSE 0 END), 0) AS score,
    COALESCE(SUM(CASE WHEN load_failed = 0 THEN 2 ELSE 0 END), 0) AS maxScore,
    COALESCE(SUM(CASE WHEN load_failed = 1 THEN 1 ELSE 0 END), 0) AS skipped
    FROM attempt_answers WHERE attempt_id = ?`).get(attemptId) as {
      score: number;
      maxScore: number;
      skipped: number;
    };
}

export function updateAttemptTotals(database: DatabaseSync, attemptId: string) {
  const totals = attemptTotals(database, attemptId);
  database.prepare(`UPDATE attempts SET score = ?, max_score = ?, skipped = ?
    WHERE id = ? AND user_id = 'owner'`).run(totals.score, totals.maxScore, totals.skipped, attemptId);
  return totals;
}
