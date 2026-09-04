import { getQuiz, quizzes, type Track } from "../../quiz-data";
import { isAccepted, isArtistAccepted } from "../../scoring";
import { getLocalDb, inTransaction } from "../../../server/local-db";
import { applyMistakeResult, rebuildMistakeMasteryForTrack } from "../../../server/mistake-mastery";

export const runtime = "nodejs";

type SubmittedAnswer = {
  trackKey?: string;
  artistAnswer?: string;
  titleAnswer?: string;
  loadFailed?: boolean;
  loadErrorCode?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { quizId?: string; answers?: SubmittedAnswer[] };
    if (!body.quizId || !Array.isArray(body.answers)) {
      return Response.json({ error: "Некорректный результат квиза" }, { status: 400 });
    }

    const fixedQuiz = getQuiz(body.quizId);
    let quiz: { id: string; title: string; tracks: Track[] } | undefined = fixedQuiz;
    if (body.quizId === "mistakes") {
      const allTracks = new Map(quizzes.flatMap((item) => item.tracks).map((item) => [item.key, item]));
      const requestedKeys = [...new Set(body.answers.map((answer) => answer.trackKey).filter((key): key is string => Boolean(key)))];
      const tracks = requestedKeys.map((key) => allTracks.get(key)).filter((item): item is Track => Boolean(item));
      if (tracks.length && tracks.length <= 30 && tracks.length === requestedKeys.length) {
        quiz = { id: "mistakes", title: "Работа над ошибками", tracks };
      }
    }
    if (!quiz) return Response.json({ error: "Некорректный результат квиза" }, { status: 400 });

    const byKey = new Map(body.answers.map((answer) => [answer.trackKey, answer]));
    const reviewed = quiz.tracks.map((track) => {
      const answer = byKey.get(track.key) ?? {};
      const loadFailed = Boolean(answer.loadFailed);
      const artistAnswer = String(answer.artistAnswer ?? "").slice(0, 160);
      const titleAnswer = String(answer.titleAnswer ?? "").slice(0, 160);
      const loadErrorCode = loadFailed && Number.isInteger(answer.loadErrorCode)
        ? Math.max(0, Math.min(999, Number(answer.loadErrorCode)))
        : null;
      return {
        track,
        loadFailed,
        loadErrorCode,
        artistAnswer,
        titleAnswer,
        artistPoint: loadFailed ? 0 : Number(isArtistAccepted(artistAnswer, track.artistAliases, track.artistForm)),
        titlePoint: loadFailed ? 0 : Number(isAccepted(titleAnswer, track.titleAliases)),
      };
    });

    const skipped = reviewed.filter((item) => item.loadFailed).length;
    const score = reviewed.reduce((sum, item) => sum + item.artistPoint + item.titlePoint, 0);
    const maxScore = (quiz.tracks.length - skipped) * 2;
    const attemptId = crypto.randomUUID();
    const database = getLocalDb();

    inTransaction(database, () => {
      database.prepare(`INSERT INTO attempts
        (id, user_id, quiz_id, quiz_title, score, max_score, skipped)
        VALUES (?, 'owner', ?, ?, ?, ?, ?)`)
        .run(attemptId, quiz.id, quiz.title, score, maxScore, skipped);
      const insertAnswer = database.prepare(`INSERT INTO attempt_answers
        (attempt_id, track_key, artist, title, artist_answer, title_answer, artist_point, title_point, load_failed, load_error_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const item of reviewed) {
        insertAnswer.run(
          attemptId,
          item.track.key,
          item.track.artist,
          item.track.title,
          item.artistAnswer,
          item.titleAnswer,
          item.artistPoint,
          item.titlePoint,
          item.loadFailed ? 1 : 0,
          item.loadErrorCode,
        );
        applyMistakeResult(database, {
          trackKey: item.track.key,
          artist: item.track.artist,
          title: item.track.title,
          artistPoint: item.artistPoint,
          titlePoint: item.titlePoint,
          loadFailed: item.loadFailed,
        });
        if (item.loadFailed) {
          database.prepare(`INSERT OR IGNORE INTO fragment_reports
            (attempt_id, quiz_id, track_key, artist, title, youtube_id, clip_start, clip_duration, reason, player_error_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'load-failed', ?)`).run(
              attemptId,
              quiz.id,
              item.track.key,
              item.track.artist,
              item.track.title,
              item.track.youtubeId,
              item.track.start,
              item.track.duration,
              item.loadErrorCode,
            );
        }
      }
    });

    return Response.json({ attemptId, score, maxScore, skipped, reviewed });
  } catch (error) {
    console.error("attempt save failed", error);
    return Response.json({ error: "Не удалось сохранить результат" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      attemptId?: string;
      trackKey?: string;
      points?: number;
      annulled?: boolean;
    };
    if (!body.attemptId || !body.trackKey || (body.points === undefined && body.annulled === undefined)) {
      return Response.json({ error: "Некорректное исправление" }, { status: 400 });
    }
    if (body.points !== undefined && ![0, 1, 2].includes(body.points)) {
      return Response.json({ error: "Баллы должны быть от 0 до 2" }, { status: 400 });
    }
    const attemptId = body.attemptId;
    const trackKey = body.trackKey;

    const database = getLocalDb();
    const ownedAnswer = database.prepare(`SELECT aa.id
      FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
      WHERE aa.attempt_id = ? AND aa.track_key = ? AND a.user_id = 'owner'`)
      .get(attemptId, trackKey) as { id: number } | undefined;
    if (!ownedAnswer) return Response.json({ error: "Ответ не найден" }, { status: 404 });

    const result = inTransaction(database, () => {
      if (body.points !== undefined) {
        const artistPoint = Math.min(body.points, 1);
        const titlePoint = Math.max(body.points - 1, 0);
        database.prepare(`UPDATE attempt_answers
          SET artist_point = ?, title_point = ?, load_failed = 0 WHERE id = ?`)
          .run(artistPoint, titlePoint, ownedAnswer.id);
      } else {
        database.prepare("UPDATE attempt_answers SET load_failed = ? WHERE id = ?")
          .run(body.annulled ? 1 : 0, ownedAnswer.id);
      }

      const totals = database.prepare(`SELECT
        COALESCE(SUM(CASE WHEN load_failed = 0 THEN artist_point + title_point ELSE 0 END), 0) AS score,
        COALESCE(SUM(CASE WHEN load_failed = 0 THEN 2 ELSE 0 END), 0) AS maxScore,
        COALESCE(SUM(CASE WHEN load_failed = 1 THEN 1 ELSE 0 END), 0) AS skipped
        FROM attempt_answers WHERE attempt_id = ?`).get(attemptId) as {
          score: number;
          maxScore: number;
          skipped: number;
        };

      database.prepare(`UPDATE attempts SET score = ?, max_score = ?, skipped = ?
        WHERE id = ? AND user_id = 'owner'`)
        .run(totals.score, totals.maxScore, totals.skipped, attemptId);

      const answer = database.prepare(`SELECT artist_point AS artistPoint,
        title_point AS titlePoint, load_failed AS loadFailed
        FROM attempt_answers WHERE id = ?`).get(ownedAnswer.id) as {
          artistPoint: number;
          titlePoint: number;
          loadFailed: number;
        };
      rebuildMistakeMasteryForTrack(database, trackKey);
      return { ...totals, ...answer, loadFailed: Boolean(answer.loadFailed) };
    });

    return Response.json(result);
  } catch (error) {
    console.error("attempt correction failed", error);
    return Response.json({ error: "Не удалось сохранить исправление" }, { status: 500 });
  }
}
