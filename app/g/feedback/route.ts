import { quizzes } from "../../quiz-data";
import { getLocalDb } from "../../../server/local-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const database = getLocalDb();
    const reportRows = database.prepare(`SELECT quiz_id AS quizId, track_key AS trackKey,
      artist, title, youtube_id AS youtubeId, clip_start AS clipStart,
      clip_duration AS clipDuration, reason, player_error_code AS playerErrorCode,
      COUNT(*) AS reports, MAX(created_at) AS lastReportedAt
      FROM fragment_reports
      GROUP BY quiz_id, track_key, artist, title, youtube_id, clip_start, clip_duration, reason, player_error_code
      ORDER BY reports DESC, lastReportedAt DESC LIMIT 200`).all() as Array<{
        quizId: string;
        trackKey: string;
        artist: string;
        title: string;
        youtubeId: string;
        clipStart: number;
        clipDuration: number;
        reason: string;
        playerErrorCode: number | null;
        reports: number;
        lastReportedAt: string;
      }>;
    const currentSegments = new Map(quizzes.flatMap((quiz) => quiz.tracks.map((track) => [track.key, track] as const)));
    const badFragments = reportRows.filter((report) => {
      const current = currentSegments.get(report.trackKey);
      return current && current.youtubeId === report.youtubeId && current.start === report.clipStart && current.duration === report.clipDuration;
    });
    const mistakes = database.prepare(`SELECT aa.track_key AS trackKey, aa.artist, aa.title,
      COUNT(*) AS misses, MAX(a.created_at) AS lastMissedAt
      FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
      WHERE a.user_id = 'owner' AND aa.load_failed = 0 AND (aa.artist_point + aa.title_point) < 2
      GROUP BY aa.track_key, aa.artist, aa.title
      ORDER BY misses DESC, lastMissedAt DESC LIMIT 200`).all();
    return Response.json({ badFragments, mistakes }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("feedback feed unavailable", error);
    return Response.json({ error: "Обратная связь временно недоступна" }, { status: 500 });
  }
}
