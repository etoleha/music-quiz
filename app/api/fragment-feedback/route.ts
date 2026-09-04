import { quizzes } from "../../quiz-data";
import { getLocalDb, inTransaction } from "../../../server/local-db";
import { rebuildMistakeMasteryForTrack } from "../../../server/mistake-mastery";
import {
  applyBadFragmentScoreRule,
  restoreAutoAnnulledAnswer,
  updateAttemptTotals,
} from "../../../server/feedback-scoring";

export const runtime = "nodejs";

const feedbackReasons = new Set(["bad-fragment", "load-failed", "wrong-video", "not-eligible", "wrong-metadata"]);
type FeedbackBody = { attemptId?: string; trackKey?: string; reason?: string };

const allTracks = () => new Map(
  quizzes.flatMap((quiz) => quiz.tracks.map((track) => [track.key, { quizId: quiz.id, track }] as const)),
);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FeedbackBody;
    if (!body.attemptId || !body.trackKey) {
      return Response.json({ error: "Некорректная отметка" }, { status: 400 });
    }
    const attemptId = body.attemptId;
    const trackKey = body.trackKey;
    const database = getLocalDb();
    const requestedReason = body.reason || "bad-fragment";
    const reason = feedbackReasons.has(requestedReason) ? requestedReason : "bad-fragment";
    const attempt = database.prepare(`SELECT id FROM attempts
      WHERE id = ? AND user_id = 'owner'`).get(attemptId) as { id: string } | undefined;
    const source = allTracks().get(trackKey);
    if (!attempt || !source) return Response.json({ error: "Результат не найден" }, { status: 404 });

    const result = inTransaction(database, () => {
      const disposition = reason === "bad-fragment"
        ? applyBadFragmentScoreRule(database, attemptId, trackKey)
        : { loadFailed: false, autoAnnulled: false };
      const autoAnnulled = disposition.autoAnnulled;
      database.prepare(`INSERT INTO fragment_reports
        (attempt_id, quiz_id, track_key, artist, title, youtube_id, clip_start, clip_duration, reason, auto_annulled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id, track_key) DO UPDATE SET
          reason = excluded.reason,
          auto_annulled = excluded.auto_annulled,
          created_at = CURRENT_TIMESTAMP`).run(
          attemptId,
          source.quizId,
          source.track.key,
          source.track.artist,
          source.track.title,
          source.track.youtubeId,
          source.track.start,
          source.track.duration,
          reason,
          autoAnnulled ? 1 : 0,
        );
      rebuildMistakeMasteryForTrack(database, trackKey);
      const totals = updateAttemptTotals(database, attemptId);
      return { ...totals, loadFailed: disposition.loadFailed, autoAnnulled };
    });
    return Response.json({ reported: true, ...result });
  } catch (error) {
    console.error("fragment feedback save failed", error);
    return Response.json({ error: "Не удалось сохранить отметку" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as FeedbackBody;
    if (!body.attemptId || !body.trackKey) {
      return Response.json({ error: "Некорректная отметка" }, { status: 400 });
    }
    const attemptId = body.attemptId;
    const trackKey = body.trackKey;
    const database = getLocalDb();
    const result = inTransaction(database, () => {
      const report = database.prepare(`SELECT auto_annulled AS autoAnnulled FROM fragment_reports
        WHERE attempt_id = ? AND track_key = ?`).get(attemptId, trackKey) as { autoAnnulled: number } | undefined;
      database.prepare(`DELETE FROM fragment_reports WHERE attempt_id = ? AND track_key = ?
        AND EXISTS (SELECT 1 FROM attempts WHERE id = ? AND user_id = 'owner')`)
        .run(attemptId, trackKey, attemptId);
      if (report?.autoAnnulled) {
        restoreAutoAnnulledAnswer(database, attemptId, trackKey);
      }
      rebuildMistakeMasteryForTrack(database, trackKey);
      const totals = updateAttemptTotals(database, attemptId);
      return { ...totals, loadFailed: report?.autoAnnulled ? false : undefined };
    });
    return Response.json({ reported: false, ...result });
  } catch (error) {
    console.error("fragment feedback delete failed", error);
    return Response.json({ error: "Не удалось снять отметку" }, { status: 500 });
  }
}
