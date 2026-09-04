import { quizzes } from "../../quiz-data";
import { getLocalDb } from "../../../server/local-db";

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
    const database = getLocalDb();
    const requestedReason = body.reason || "bad-fragment";
    const reason = feedbackReasons.has(requestedReason) ? requestedReason : "bad-fragment";
    const attempt = database.prepare(`SELECT id FROM attempts
      WHERE id = ? AND user_id = 'owner'`).get(body.attemptId) as { id: string } | undefined;
    const source = allTracks().get(body.trackKey);
    if (!attempt || !source) return Response.json({ error: "Результат не найден" }, { status: 404 });

    database.prepare(`INSERT INTO fragment_reports
      (attempt_id, quiz_id, track_key, artist, title, youtube_id, clip_start, clip_duration, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(attempt_id, track_key) DO UPDATE SET reason = excluded.reason, created_at = CURRENT_TIMESTAMP`).run(
        body.attemptId,
        source.quizId,
        source.track.key,
        source.track.artist,
        source.track.title,
        source.track.youtubeId,
        source.track.start,
        source.track.duration,
        reason,
      );
    return Response.json({ reported: true });
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
    const database = getLocalDb();
    database.prepare(`DELETE FROM fragment_reports WHERE attempt_id = ? AND track_key = ?
      AND EXISTS (SELECT 1 FROM attempts WHERE id = ? AND user_id = 'owner')`)
      .run(body.attemptId, body.trackKey, body.attemptId);
    return Response.json({ reported: false });
  } catch (error) {
    console.error("fragment feedback delete failed", error);
    return Response.json({ error: "Не удалось снять отметку" }, { status: 500 });
  }
}
