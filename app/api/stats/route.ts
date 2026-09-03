import { getLocalDb } from "../../../server/local-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const database = getLocalDb();
    database.prepare(`INSERT OR IGNORE INTO attempts
      (id, user_id, quiz_id, quiz_title, score, max_score, skipped, created_at)
      VALUES (?, 'owner', ?, ?, ?, ?, ?, ?)`).run(
        "legacy-hard-1", "hard-1", "Сложный уровень I", 35, 48, 0, "2026-09-03 09:30:00",
      );
    database.prepare(`INSERT OR IGNORE INTO attempts
      (id, user_id, quiz_id, quiz_title, score, max_score, skipped, created_at)
      VALUES (?, 'owner', ?, ?, ?, ?, ?, ?)`).run(
        "legacy-hard-2", "hard-2", "Сложный уровень II", 34, 48, 0, "2026-09-03 10:30:00",
      );

    const attempts = database.prepare(`SELECT id, quiz_id AS quizId, quiz_title AS quizTitle,
      score, max_score AS maxScore, skipped, created_at AS createdAt
      FROM attempts WHERE user_id = 'owner' ORDER BY created_at DESC`).all();
    const weakTracks = database.prepare(`SELECT aa.track_key AS trackKey, artist, title, COUNT(*) AS misses
      FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
      WHERE a.user_id = 'owner' AND aa.load_failed = 0 AND (aa.artist_point + aa.title_point) < 2
      GROUP BY aa.track_key, artist, title ORDER BY misses DESC, artist ASC LIMIT 120`).all();

    return Response.json({ attempts, weakTracks });
  } catch (error) {
    console.error("stats unavailable", error);
    return Response.json({ error: "Статистика временно недоступна" }, { status: 500 });
  }
}
