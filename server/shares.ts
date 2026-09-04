import { randomBytes } from "node:crypto";
import { getUnresolvedFragmentReportKeys } from "./feedback";
import { getLocalDb } from "./local-db";

export type GuestComparison = {
  score: number;
  maxScore: number;
  answers: Array<{
    trackKey: string;
    artistAnswer: string;
    titleAnswer: string;
    points: number;
    loadFailed: boolean;
  }>;
};

export function createOrReuseShare(quizId: string) {
  const database = getLocalDb();
  const existing = database.prepare("SELECT token FROM quiz_shares WHERE quiz_id = ?")
    .get(quizId) as { token: string } | undefined;
  if (existing) return existing.token;

  const token = randomBytes(24).toString("base64url");
  database.prepare("INSERT INTO quiz_shares (token, quiz_id) VALUES (?, ?)").run(token, quizId);
  return token;
}

export function getGuestShare(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const database = getLocalDb();
  const share = database.prepare("SELECT quiz_id AS quizId FROM quiz_shares WHERE token = ?")
    .get(token) as { quizId: string } | undefined;
  if (!share) return null;
  const excludedTrackKeys = getUnresolvedFragmentReportKeys(database, share.quizId);

  const attempt = database.prepare(`SELECT id, score, max_score AS maxScore
    FROM attempts WHERE user_id = 'owner' AND quiz_id = ?
    ORDER BY created_at DESC LIMIT 1`).get(share.quizId) as { id: string; score: number; maxScore: number } | undefined;

  let comparison: GuestComparison | null = null;
  if (attempt) {
    const answers = database.prepare(`SELECT track_key AS trackKey,
      artist_answer AS artistAnswer, title_answer AS titleAnswer,
      artist_point + title_point AS points, load_failed AS loadFailed
      FROM attempt_answers WHERE attempt_id = ?`).all(attempt.id) as Array<{
        trackKey: string;
        artistAnswer: string;
        titleAnswer: string;
        points: number;
        loadFailed: number;
      }>;
    const visibleAnswers = answers
      .filter((answer) => !excludedTrackKeys.has(answer.trackKey))
      .map((answer) => ({ ...answer, loadFailed: Boolean(answer.loadFailed) }));
    comparison = {
      score: visibleAnswers.length
        ? visibleAnswers.reduce((sum, answer) => sum + (answer.loadFailed ? 0 : answer.points), 0)
        : attempt.score,
      maxScore: visibleAnswers.length
        ? visibleAnswers.reduce((sum, answer) => sum + (answer.loadFailed ? 0 : 2), 0)
        : attempt.maxScore,
      answers: visibleAnswers,
    };
  }

  return { quizId: share.quizId, comparison, excludedTrackKeys: [...excludedTrackKeys] };
}
