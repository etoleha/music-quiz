import { NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { attemptEpisode, jumpVideoAttempt } from "./video-quizzes";
import { VideoError, episodes, publicEpisode, sharedEpisode, guestIdentity, createGuest, startVideoAttempt, syncVideoAttempt, getVideoAttempt, videoHistory, shareFor, reportVideoQuestion, correctVideoAnswer, videoReports, episodeById, videoDb } from "./video-quizzes";

function secret(request: Request) { return request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith("vq_guest="))?.slice(9); }
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
export async function videoApi(request: Request, guest: boolean) {
  try {
    const url = new URL(request.url);
    let body: Record<string, any> = {};
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).host !== request.headers.get("host")) throw new VideoError("Недопустимый источник запроса", 403);
      if (!request.headers.get("content-type")?.startsWith("application/json")) throw new VideoError("Ожидается JSON", 415);
      const text = await request.text(); if (text.length > 60000) throw new VideoError("Слишком большой запрос", 413);
      body = JSON.parse(text);
      if (!body || Array.isArray(body) || typeof body !== "object") throw new VideoError("Ожидается объект запроса");
    }
    const share = guest ? sharedEpisode(String(url.searchParams.get("share") || "")) : null;
    let identity = guest ? guestIdentity(secret(request)) : { id: "owner", name: "Алексей" };
    let newSecret: string | undefined;
    if (guest && !identity && request.method === "POST" && body.action === "start") {
      const created = createGuest(String(body.name || "Гость")); identity = created; newSecret = created.secret;
    }
    const player = identity?.id;
    const permitted = (quizId: string) => { if (share && share.id !== quizId) throw new VideoError("Выпуск недоступен по этой ссылке", 403); };
    const attempt = () => {
      if (!player) throw new VideoError("Сначала начните прохождение", 401);
      const a = getVideoAttempt(String(body.attemptId || url.searchParams.get("attemptId") || ""), player, !guest && ["correct", "report"].includes(body.action));
      permitted(a.quizId); return a;
    };
    let result: unknown;
    if (request.method === "GET") {
      if (url.searchParams.has("attemptId")) result = { attempt: attempt() };
      else result = { episodes: (share ? [share] : episodes()).map(publicEpisode), history: player ? videoHistory(player, !guest) : [], reports: guest ? [] : videoReports(), name: identity?.name || "", guest };
    } else switch (body.action) {
      case "start": {
        if (!player) throw new VideoError("Не удалось создать гостя", 401);
        const id = String(body.quizId || ""); permitted(id);
        const a = startVideoAttempt(player, id, body.fresh === true); result = { attempt: a, episode: attemptEpisode(a.id, player) }; break;
      }
      case "open": { const a = attempt(); result = { attempt: a, episode: attemptEpisode(a.id, player!) }; break; }
      case "sync": case "submit": {
        const a = attempt();
        result = { attempt: syncVideoAttempt(a.id, player!, Number(body.position), body.drafts && typeof body.drafts === "object" ? body.drafts : {}, body.action === "submit" ? String(body.questionId) : undefined) }; break;
      }
      case "jump": {
        const a = attempt();
        result = { attempt: jumpVideoAttempt(a.id, player!, Number(body.position), body.drafts && typeof body.drafts === "object" ? body.drafts : {}) }; break;
      }
      case "report": { const a = attempt(); result = reportVideoQuestion(a.id, player!, String(body.questionId), String(body.comment || "")); break; }
      case "share": if (guest) throw new VideoError("Только ведущий", 403); result = { token: shareFor(String(body.quizId)) }; break;
      case "review": if (guest) throw new VideoError("Только ведущий", 403); result = { attempt: getVideoAttempt(String(body.attemptId), "owner", true), episode: attemptEpisode(String(body.attemptId), "owner", true) }; break;
      case "correct": if (guest) throw new VideoError("Только ведущий", 403); result = { attempt: correctVideoAnswer(String(body.attemptId), String(body.questionId), { points: body.points, annulled: body.annulled, global: body.global, reason: String(body.reason || ""), reasonCode: body.reasonCode }) }; break;
      case "resolveReport": if (guest) throw new VideoError("Только ведущий", 403); videoDb().prepare("UPDATE video_reports SET status='resolved' WHERE id=?").run(String(body.reportId)); result = { ok: true }; break;
      default: throw new VideoError("Неизвестное действие");
    }
    const response = json(result);
    if (newSecret) response.cookies.set("vq_guest", newSecret, { httpOnly: true, sameSite: "lax", secure: request.headers.get("x-forwarded-proto") === "https" || url.protocol === "https:", path: "/g", maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch (error) {
    if (error instanceof VideoError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: "Некорректный запрос" }, 400);
    console.error("video quiz API", error); return json({ error: "Не удалось сохранить изменения. Видео поставлено на паузу; повторите запрос." }, 500);
  }
}

export function videoMedia(request: Request, id: string, guest: boolean) {
  try {
    const e = episodeById(id);
    if (guest) {
      const share = sharedEpisode(new URL(request.url).searchParams.get("share") || "");
      if (!guestIdentity(secret(request)) || share.id !== e.id) throw new VideoError("Сначала откройте гостевой квиз", 403);
    }
    const version = /^prosto-v(\d+)$/.exec(e.id)?.[1];
    const localFile = version ? join(process.cwd(), `work/prosto-quiz-v${version}/output/Просто квиз — 8 раундов.mp4`) : "";
    const file = process.env.VIDEO_QUIZ_MEDIA_DIR ? join(process.env.VIDEO_QUIZ_MEDIA_DIR, e.mediaFile) : existsSync(localFile) ? localFile : join("/opt/music-quiz/media", e.mediaFile);
    if (!existsSync(file)) throw new VideoError("Видео ещё не загружено на сервер", 404);
    const size = statSync(file).size;
    const range = request.headers.get("range"); let start = 0, end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); end = match[2] ? Math.min(size - 1, Number(match[2])) : end; }
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "Cache-Control": "private, no-store", ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) };
    return new Response(request.method === "HEAD" ? null : Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: range ? 206 : 200, headers });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Видео недоступно" }, error instanceof VideoError ? error.status : 500); }
}
