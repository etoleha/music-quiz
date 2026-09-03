import { getLocalDb, inTransaction } from "../../../server/local-db";

export const runtime = "nodejs";

type LegacyAttempt = {
  id?: unknown;
  quiz_id?: unknown;
  quiz_title?: unknown;
  score?: unknown;
  max_score?: unknown;
  skipped?: unknown;
  created_at?: unknown;
};

type LegacyAnswer = {
  attempt_id?: unknown;
  track_key?: unknown;
  artist?: unknown;
  title?: unknown;
  artist_answer?: unknown;
  title_answer?: unknown;
  artist_point?: unknown;
  title_point?: unknown;
  load_failed?: unknown;
};

const shortText = (value: unknown, max = 220) =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

const integer = (value: unknown, min: number, max: number) =>
  Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { attempts?: LegacyAttempt[]; answers?: LegacyAnswer[] };
    if (!Array.isArray(body.attempts) || !Array.isArray(body.answers) || body.attempts.length > 100 || body.answers.length > 5000) {
      return Response.json({ error: "Некорректный архив статистики" }, { status: 400 });
    }

    const attempts = body.attempts.map((item) => {
      const id = shortText(item.id, 120);
      const quizId = shortText(item.quiz_id, 120);
      const quizTitle = shortText(item.quiz_title);
      const score = integer(item.score, 0, 1000);
      const maxScore = integer(item.max_score, 0, 1000);
      const skipped = integer(item.skipped, 0, 1000);
      const createdAt = shortText(item.created_at, 80);
      if (!id || !quizId || !quizTitle || score === null || maxScore === null || skipped === null || !createdAt || score > maxScore) {
        throw new Error("invalid attempt");
      }
      return { id, quizId, quizTitle, score, maxScore, skipped, createdAt };
    });

    const importedAttemptIds = new Set(attempts.map((item) => item.id));
    const answers = body.answers.map((item) => {
      const attemptId = shortText(item.attempt_id, 120);
      const trackKey = shortText(item.track_key, 400);
      const artist = shortText(item.artist);
      const title = shortText(item.title);
      const artistAnswer = typeof item.artist_answer === "string" ? item.artist_answer.slice(0, 220) : "";
      const titleAnswer = typeof item.title_answer === "string" ? item.title_answer.slice(0, 220) : "";
      const artistPoint = integer(item.artist_point, 0, 1);
      const titlePoint = integer(item.title_point, 0, 1);
      const loadFailed = integer(item.load_failed, 0, 1);
      if (!attemptId || !trackKey || !artist || !title || artistPoint === null || titlePoint === null || loadFailed === null) {
        throw new Error("invalid answer");
      }
      return { attemptId, trackKey, artist, title, artistAnswer, titleAnswer, artistPoint, titlePoint, loadFailed };
    });

    const database = getLocalDb();
    const result = inTransaction(database, () => {
      const insertAttempt = database.prepare(`INSERT OR IGNORE INTO attempts
        (id, user_id, quiz_id, quiz_title, score, max_score, skipped, created_at)
        VALUES (?, 'owner', ?, ?, ?, ?, ?, ?)`);
      for (const item of attempts) {
        insertAttempt.run(item.id, item.quizId, item.quizTitle, item.score, item.maxScore, item.skipped, item.createdAt);
      }

      const insertAnswer = database.prepare(`INSERT OR IGNORE INTO attempt_answers
        (attempt_id, track_key, artist, title, artist_answer, title_answer, artist_point, title_point, load_failed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const ownedAttempt = database.prepare("SELECT 1 FROM attempts WHERE id = ? AND user_id = 'owner'");
      for (const item of answers) {
        if (!importedAttemptIds.has(item.attemptId) && !ownedAttempt.get(item.attemptId)) continue;
        insertAnswer.run(
          item.attemptId,
          item.trackKey,
          item.artist,
          item.title,
          item.artistAnswer,
          item.titleAnswer,
          item.artistPoint,
          item.titlePoint,
          item.loadFailed,
        );
      }

      return {
        attempts: Number((database.prepare("SELECT COUNT(*) AS count FROM attempts WHERE user_id = 'owner'").get() as { count: number }).count),
        answers: Number((database.prepare(`SELECT COUNT(*) AS count FROM attempt_answers aa
          JOIN attempts a ON a.id = aa.attempt_id WHERE a.user_id = 'owner'`).get() as { count: number }).count),
      };
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("legacy import failed", error);
    return Response.json({ error: "Не удалось перенести статистику" }, { status: 400 });
  }
}