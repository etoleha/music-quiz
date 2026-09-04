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
    const weakTracks = database.prepare(`SELECT track_key AS trackKey, artist, title,
      successes, required_successes AS requiredSuccesses, misses
      FROM mistake_mastery WHERE active = 1
      ORDER BY successes ASC, misses DESC, last_error_at DESC, artist ASC LIMIT 120`).all();

    return Response.json({ attempts, weakTracks });
  } catch (error) {
    console.error("stats unavailable", error);
    return Response.json({ error: "Статистика временно недоступна" }, { status: 500 });
  }
}
