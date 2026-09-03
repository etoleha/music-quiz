import { quizzes } from "../../quiz-data";
import { getLocalDb } from "../../../server/local-db";

export const runtime = "nodejs";

type FeedbackBody = { attemptId?: string; trackKey?: string };

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
    const attempt = database.prepare(`SELECT id FROM attempts
      WHERE id = ? AND user_id = 'owner'`).get(body.attemptId) as { id: string } | undefined;
    const source = allTracks().get(body.trackKey);
    if (!attempt || !source) return Response.json({ error: "Результат не найден" }, { status: 404 });

    database.prepare(`INSERT OR IGNORE INTO fragment_reports
      (attempt_id, quiz_id, track_key, artist, title, youtube_id, clip_start, clip_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        body.attemptId,
        source.quizId,
        source.track.key,
        source.track.artist,
        source.track.title,
        source.track.youtubeId,
        source.track.start,
        source.track.duration,
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
