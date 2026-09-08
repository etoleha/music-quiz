import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getLocalDb, inTransaction } from "./local-db.ts";
import { isAccepted, isArtistAccepted } from "../app/scoring.ts";
import { chanceAt, questionMaximum, type VideoEpisode, type VideoQuestion, type VideoDraft, type VideoAttempt, type VideoAnswer } from "../shared/video-quiz.ts";

export type PrivateQuestion = VideoQuestion & { correct: VideoDraft; aliases: { artist: string[]; title: string[] }; artistParts: string[][]; album?: string; year?: number; coverArtist?: string };
export type PrivateEpisode = Omit<VideoEpisode, "rounds"> & { mediaFile: string; rounds: Array<Omit<VideoEpisode["rounds"][number], "questions"> & { questions: PrivateQuestion[] }> };
export function episodes(): PrivateEpisode[] {
  const directory = join(process.cwd(), "server/video-data");
  return readdirSync(directory).filter(name => /^prosto-v\d+\.json$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(name => {
    const e: PrivateEpisode = JSON.parse(readFileSync(join(directory, name), "utf8"));
    if (e.id === "prosto-v3") {
      const albums = JSON.parse(readFileSync(join(directory, "album-overrides.json"), "utf8"));
      for (const r of e.rounds) if (r.number !== 7) for (const q of r.questions) if (albums[q.id]?.album) q.album = albums[q.id].album;
    }
    return e;
  });
}
export function episodeById(id: string) { const e = episodes().find(e => e.id === id); if (!e) throw new VideoError("Выпуск не найден", 404); return e; }
export function publicEpisode(e: PrivateEpisode): VideoEpisode {
  return { id: e.id, title: e.title, duration: e.duration, revision: e.revision, rounds: e.rounds.map(r => ({ number: r.number, title: r.title, start: r.start, close: r.close, reveal: r.reveal, questions: r.questions.map(q => ({ id: q.id, number: q.number, start: q.start, close: q.close, reveal: q.reveal, answerStart: q.answerStart, fields: q.fields, chances: q.chances })) })) };
}
export class VideoError extends Error { constructor(message: string, public status = 400) { super(message); } }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function videoDb(): DatabaseSync {
  const db = getLocalDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_players(id TEXT PRIMARY KEY, secret_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS video_shares(token TEXT PRIMARY KEY, quiz_id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS video_attempts(id TEXT PRIMARY KEY, player_id TEXT NOT NULL, quiz_id TEXT NOT NULL, revision TEXT NOT NULL, position REAL NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS video_attempts_player ON video_attempts(player_id,created_ms DESC);
    CREATE TABLE IF NOT EXISTS video_answers(attempt_id TEXT NOT NULL REFERENCES video_attempts(id), question_id TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', locked INTEGER NOT NULL DEFAULT 0, submitted INTEGER NOT NULL DEFAULT 0, submitted_at REAL, automatic_points REAL NOT NULL DEFAULT 0, override_points REAL, annulled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(attempt_id,question_id));
    CREATE TABLE IF NOT EXISTS video_reports(id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES video_attempts(id), question_id TEXT NOT NULL, comment TEXT NOT NULL, category TEXT NOT NULL, conclusion TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS video_audit(id TEXT PRIMARY KEY, actor TEXT NOT NULL, attempt_id TEXT NOT NULL, question_id TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS video_voids(quiz_id TEXT NOT NULL, question_id TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(quiz_id,question_id));
    CREATE TABLE IF NOT EXISTS video_episode_versions(quiz_id TEXT NOT NULL, revision TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(quiz_id,revision));
  `);
  return db;
}
export function guestIdentity(secret: string | undefined) {
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return videoDb().prepare("SELECT id,name FROM video_players WHERE secret_hash=?").get(hash(secret)) as { id: string; name: string } | undefined;
}
export function createGuest(name: string) {
  const secret = randomBytes(32).toString("base64url"), id = randomUUID();
  const clean = String(name || "Гость").trim().slice(0, 60) || "Гость";
  videoDb().prepare("INSERT INTO video_players(id,secret_hash,name) VALUES(?,?,?)").run(id, hash(secret), clean);
  return { id, name: clean, secret };
}
export function shareFor(id: string) {
  episodeById(id); const db = videoDb();
  const old = db.prepare("SELECT token FROM video_shares WHERE quiz_id=?").get(id) as { token: string } | undefined;
  if (old) return old.token;
  const token = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO video_shares VALUES(?,?,CURRENT_TIMESTAMP)").run(token, id); return token;
}
export function sharedEpisode(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new VideoError("Ссылка не найдена", 404);
  const row = videoDb().prepare("SELECT quiz_id FROM video_shares WHERE token=?").get(token) as { quiz_id: string } | undefined;
  if (!row) throw new VideoError("Ссылка не найдена", 404); return episodeById(row.quiz_id);
}
type AttemptRow = { id: string; player_id: string; quiz_id: string; revision: string; position: number; created_ms: number; updated_ms: number; completed: number };
type AnswerRow = { question_id: string; artist: string; title: string; locked: number; submitted: number; submitted_at: number | null; automatic_points: number; override_points: number | null; annulled: number };
function ownAttempt(db: DatabaseSync, id: string, player: string, admin = false) {
  const a = db.prepare("SELECT * FROM video_attempts WHERE id=?").get(id) as AttemptRow | undefined;
  if (!a || (!admin && a.player_id !== player)) throw new VideoError("Прохождение не найдено", 404);
  return a;
}
function episodeForAttempt(db: DatabaseSync, a: AttemptRow): PrivateEpisode {
  const row = db.prepare("SELECT payload_json FROM video_episode_versions WHERE quiz_id=? AND revision=?").get(a.quiz_id, a.revision) as { payload_json: string } | undefined;
  if (row) {
    const saved: PrivateEpisode = JSON.parse(row.payload_json);
    const current = episodes().find(e => e.id === saved.id && e.revision === saved.revision);
    const sameTimes = (left: VideoQuestion | PrivateEpisode["rounds"][number], right: VideoQuestion | PrivateEpisode["rounds"][number]) =>
      left.start === right.start && left.close === right.close && left.reveal === right.reveal;
    const compatible = current && current.duration === saved.duration && current.rounds.length === saved.rounds.length && saved.rounds.every(r => {
      const latest = current.rounds.find(candidate => candidate.number === r.number);
      return latest && sameTimes(r, latest) && latest.questions.length === r.questions.length && r.questions.every(q => {
        const next = latest.questions.find(candidate => candidate.id === q.id);
        return next && sameTimes(q, next);
      });
    });
    if (compatible) for (const r of saved.rounds) for (const q of r.questions) {
      const next = current.rounds.find(candidate => candidate.number === r.number)!.questions.find(candidate => candidate.id === q.id)!;
      // Navigation-only enrichment: never replace a snapshot's keys, rules or existing timings.
      if (q.answerStart === undefined && Number.isFinite(next.answerStart) && next.answerStart! >= q.reveal && next.answerStart! <= saved.duration) q.answerStart = next.answerStart;
    }
    return saved;
  }
  const current = episodeById(a.quiz_id);
  if (current.revision !== a.revision) throw new VideoError("Версия этого прохождения не найдена", 409);
  return current;
}
export function attemptEpisode(id: string, player: string, admin = false) { const db = videoDb(); return publicEpisode(episodeForAttempt(db, ownAttempt(db, id, player, admin))); }
export function scoreVideoAnswer(q: PrivateQuestion, draft: VideoDraft, position: number): number {
  const artistForm = q.fields.find(field => field.key === "artist")?.label || "";
  let artist = Number(isArtistAccepted(draft.artist, [q.correct.artist, ...q.aliases.artist], artistForm));
  if (q.artistParts.length >= 2) {
    const forms = artistForm.split(/\s*\+\s*/);
    // Short surnames and short band names must also work in a combined answer.
    const candidates = [draft.artist, ...draft.artist.split(/\s+(?:feat\.?|ft\.?|and|и|x)\s+|\s*[+&,/]\s*/i)];
    const hits = q.artistParts.filter((part, index) => candidates.some(value => isArtistAccepted(value, part, forms[index] || ""))).length;
    artist = hits === q.artistParts.length ? 1 : hits > 0 ? .5 : 0;
  }
  if (q.chances.length) return artist === 1 ? chanceAt(q, position)?.points ?? 0 : 0;
  const title = Number(isAccepted(draft.title, [q.correct.title, ...q.aliases.title]));
  return q.fields.length === 1 ? q.fields[0].key === "artist" ? artist : title : artist + title * .5;
}
export function startVideoAttempt(player: string, quizId: string, fresh = false, now = Date.now()) {
  const e = episodeById(quizId), db = videoDb();
  if (!fresh) {
    const old = db.prepare("SELECT id FROM video_attempts WHERE player_id=? AND quiz_id=? AND revision=? AND completed=0 ORDER BY created_ms DESC LIMIT 1").get(player, quizId, e.revision) as { id: string } | undefined;
    if (old) return getVideoAttempt(old.id, player);
  }
  const id = randomUUID();
  inTransaction(db, () => {
    db.prepare("INSERT OR IGNORE INTO video_episode_versions VALUES(?,?,?)").run(e.id, e.revision, JSON.stringify(e));
    db.prepare("INSERT INTO video_attempts(id,player_id,quiz_id,revision,created_ms,updated_ms) VALUES(?,?,?,?,?,?)").run(id, player, quizId, e.revision, now, now);
    for (const q of e.rounds.flatMap(r => r.questions)) db.prepare("INSERT INTO video_answers(attempt_id,question_id) VALUES(?,?)").run(id, q.id);
  });
  return getVideoAttempt(id, player);
}
export function getVideoAttempt(id: string, player: string, admin = false): VideoAttempt {
  const db = videoDb(), a = ownAttempt(db, id, player, admin), e = episodeForAttempt(db, a);
  const rows = db.prepare("SELECT * FROM video_answers WHERE attempt_id=?").all(id) as AnswerRow[];
  const voids = new Set((db.prepare("SELECT question_id FROM video_voids WHERE quiz_id=?").all(a.quiz_id) as { question_id: string }[]).map(x => x.question_id));
  const answers: Record<string, VideoAnswer> = {}; let score = 0, maxScore = 0;
  for (const q of e.rounds.flatMap(r => r.questions)) {
    const row = rows.find(x => x.question_id === q.id)!;
    const visible = a.position >= q.reveal;
    const annulled = !!row.annulled || voids.has(q.id);
    // Re-evaluate submitted historical drafts with the current, more generous matcher.
    // Existing awards never decrease, and explicit overrides/annulments still take precedence.
    const automaticPoints = row.submitted ? Math.max(row.automatic_points, scoreVideoAnswer(q, { artist: row.artist, title: row.title }, row.submitted_at ?? q.close)) : 0;
    const points = annulled ? 0 : row.override_points ?? automaticPoints;
    if (visible && !annulled) { score += points; maxScore += questionMaximum(q); }
    answers[q.id] = { draft: { artist: row.artist, title: row.title }, locked: !!row.locked, submitted: !!row.submitted, submittedAt: row.submitted_at, possible: questionMaximum(q),
      ...(visible ? { points, automaticPoints, annulled, correct: q.correct, album: q.album, year: q.year, coverArtist: q.coverArtist } : {}) };
  }
  const p = db.prepare("SELECT name FROM video_players WHERE id=?").get(a.player_id) as { name: string } | undefined;
  return { id, quizId: a.quiz_id, name: p?.name || "Ведущий", position: a.position, score, maxScore, completed: !!a.completed, answers };
}
export function syncVideoAttempt(id: string, player: string, requestedPosition: number, drafts: Record<string, VideoDraft>, submitQuestion?: string, now = Date.now()) {
  return advanceVideoAttempt(id, player, requestedPosition, drafts, submitQuestion, now, false);
}
export function jumpVideoAttempt(id: string, player: string, target: number, drafts: Record<string, VideoDraft>, now = Date.now()) {
  return advanceVideoAttempt(id, player, target, drafts, undefined, now, true);
}
function advanceVideoAttempt(id: string, player: string, requestedPosition: number, drafts: Record<string, VideoDraft>, submitQuestion: string | undefined, now: number, jump: boolean) {
  const db = videoDb();
  inTransaction(db, () => {
    const a = ownAttempt(db, id, player), e = episodeForAttempt(db, a);
    if (!Number.isFinite(requestedPosition) || requestedPosition < 0 || requestedPosition > e.duration + .5) throw new VideoError("Неверный таймкод");
    if (jump) {
      const targets = [0, e.duration, ...e.rounds.flatMap(r => [r.start, r.reveal, ...r.questions.flatMap(q => [q.start, q.reveal, ...(q.answerStart === undefined ? [] : [q.answerStart]), ...q.chances.map(chance => chance.start)])])];
      const target = targets.find(value => Math.abs(value - requestedPosition) <= .001);
      if (target === undefined) throw new VideoError("Выберите начало раунда, вопроса, ответа или конец", 400);
      if (target < a.position - .001) throw new VideoError("Во время прохождения нельзя возвращаться назад", 409);
      requestedPosition = target;
    } else if (requestedPosition > a.position + Math.max(0, now - a.updated_ms) / 1000 + 1) {
      // Explicit chapter jumps establish a new playback baseline; ordinary sync cannot jump ahead.
      throw new VideoError("Нельзя перейти к ещё не просмотренному моменту", 409);
    }
    const position = Math.max(a.position, Math.min(e.duration, requestedPosition));
    const questions = e.rounds.flatMap(r => r.questions);
    if (submitQuestion) {
      const q = questions.find(q => q.id === submitQuestion);
      if (!q?.chances.length || !chanceAt(q, position)) throw new VideoError("Приём ответа на этого исполнителя уже закрыт", 409);
    }
    for (const q of questions) {
      const row = db.prepare("SELECT * FROM video_answers WHERE attempt_id=? AND question_id=?").get(id, q.id) as AnswerRow;
      if (row.locked) continue;
      const draft = drafts[q.id];
      let answer = { artist: row.artist, title: row.title };
      if (draft && a.position < q.close && position >= e.rounds.find(r => r.questions.some(x => x.id === q.id))!.start) {
        answer = { artist: String(draft.artist || "").slice(0, 160), title: String(draft.title || "").slice(0, 160) };
        db.prepare("UPDATE video_answers SET artist=?,title=? WHERE attempt_id=? AND question_id=?").run(answer.artist, answer.title, id, q.id);
      }
      const manual = submitQuestion === q.id;
      if (manual || position >= q.close) {
        // No auto-submission in Three Chances: an unsubmitted draft earns nothing.
        const submitted = manual || !q.chances.length;
        const at = manual ? position : q.close;
        const points = submitted ? scoreVideoAnswer(q, answer, at) : 0;
        db.prepare("UPDATE video_answers SET locked=1,submitted=?,submitted_at=?,automatic_points=? WHERE attempt_id=? AND question_id=?").run(Number(submitted), submitted ? at : null, points, id, q.id);
      }
    }
    db.prepare("UPDATE video_attempts SET position=?,updated_ms=?,completed=? WHERE id=?").run(position, now, Number(position >= e.duration - .05), id);
  });
  return getVideoAttempt(id, player);
}
export function videoHistory(player: string, admin = false) {
  const db = videoDb();
  const rows = db.prepare(`SELECT id,player_id,created_ms FROM video_attempts ${admin ? "" : "WHERE player_id=?"} ORDER BY created_ms DESC`).all(...(admin ? [] : [player])) as { id: string; player_id: string; created_ms: number }[];
  return rows.map(row => { const a = getVideoAttempt(row.id, player, admin); return { id: a.id, playerId: row.player_id, quizId: a.quizId, name: a.name, score: a.score, maxScore: a.maxScore, position: a.position, completed: a.completed, createdAt: new Date(row.created_ms).toISOString() }; });
}
export function classifyVideoReport(comment: string) {
  if (/балл|зач[её]т|опечат|правильн|написа/i.test(comment)) return { category: "scoring", conclusion: "Проверить написание и допустимые варианты ответа. Решение о баллах принимает ведущий." };
  if (/лиц|квадрат|размыт|маск/i.test(comment)) return { category: "visual", conclusion: "Проверить границы масок лиц и видимость сюжета в этом фрагменте." };
  if (/названи.*звуч|по[её]т.*назван|подсказ/i.test(comment)) return { category: "giveaway", conclusion: "Проверить, не звучит ли зачётный ответ в вопросе; подобрать другое окно." };
  if (/прост|легк|л[её]гк|сложн|повтор/i.test(comment)) return { category: "difficulty", conclusion: "Пересмотреть сложность и повторы при отборе следующего выпуска." };
  if (/звук|громк|тих|обрез|пауз/i.test(comment)) return { category: "audio", conclusion: "Перепроверить громкость и вход/выход музыкального фрагмента." };
  return { category: "editorial", conclusion: "Требуется редакторская проверка вопроса с учётом комментария игрока." };
}
export function reportVideoQuestion(id: string, player: string, questionId: string, comment: string) {
  const db = videoDb(), a = ownAttempt(db, id, player, player === "owner");
  const q = episodeForAttempt(db, a).rounds.flatMap(r => r.questions).find(q => q.id === questionId);
  const text = String(comment || "").trim().slice(0, 2000);
  if (!q || a.position < q.start || text.length < 3) throw new VideoError("Выберите показанный вопрос и напишите комментарий");
  const existing = db.prepare("SELECT id,category,conclusion,status FROM video_reports WHERE attempt_id=? AND question_id=? AND comment=?").get(id, questionId, text);
  if (existing) return existing;
  const count = db.prepare("SELECT COUNT(*) AS n FROM video_reports WHERE attempt_id=?").get(id) as { n: number };
  if (count.n >= 100) throw new VideoError("Лимит комментариев для прохождения достигнут", 429);
  const result = classifyVideoReport(text), reportId = randomUUID();
  db.prepare("INSERT INTO video_reports(id,attempt_id,question_id,comment,category,conclusion) VALUES(?,?,?,?,?,?)").run(reportId, id, questionId, text, result.category, result.conclusion);
  return { id: reportId, ...result, status: "review" };
}
export function videoReports() {
  return videoDb().prepare(`SELECT r.id,r.attempt_id AS attemptId,r.question_id AS questionId,r.comment,r.category,r.conclusion,r.status,r.created_at AS createdAt,COALESCE(p.name,'Ведущий') AS name FROM video_reports r JOIN video_attempts a ON a.id=r.attempt_id LEFT JOIN video_players p ON p.id=a.player_id ORDER BY r.created_at DESC LIMIT 300`).all();
}
export function correctVideoAnswer(id: string, questionId: string, changes: { points?: number; annulled?: boolean; global?: boolean; reason?: string; reasonCode?: string }) {
  const db = videoDb(), a = ownAttempt(db, id, "owner", true), q = episodeForAttempt(db, a).rounds.flatMap(r => r.questions).find(q => q.id === questionId);
  const acceptedAnswer = changes.reasonCode === "accepted-answer" && changes.points !== undefined && changes.annulled === undefined && !changes.global;
  const reason = String(changes.reason || "").trim() || (acceptedAnswer ? "Ответ принят ведущим" : "");
  if (!q || !reason) throw new VideoError("Нужны вопрос и причина исправления");
  if (changes.points !== undefined && (!Number.isFinite(changes.points) || changes.points < 0 || changes.points > questionMaximum(q) || !Number.isInteger(changes.points * 2))) throw new VideoError("Недопустимые баллы");
  if (a.position < q.reveal) throw new VideoError("Баллы можно править после раскрытия", 409);
  inTransaction(db, () => {
    const before = db.prepare("SELECT * FROM video_answers WHERE attempt_id=? AND question_id=?").get(id, questionId);
    if (changes.global) {
      if (changes.annulled) db.prepare("INSERT OR REPLACE INTO video_voids VALUES(?,?,?)").run(a.quiz_id, questionId, reason.slice(0, 1000));
      else db.prepare("DELETE FROM video_voids WHERE quiz_id=? AND question_id=?").run(a.quiz_id, questionId);
    } else if (changes.points !== undefined) db.prepare("UPDATE video_answers SET override_points=?,annulled=0 WHERE attempt_id=? AND question_id=?").run(changes.points, id, questionId);
    else db.prepare("UPDATE video_answers SET annulled=? WHERE attempt_id=? AND question_id=?").run(Number(!!changes.annulled), id, questionId);
    db.prepare("INSERT INTO video_audit(id,actor,attempt_id,question_id,before_json,after_json,reason) VALUES(?,'owner',?,?,?,?,?)").run(randomUUID(), id, questionId, JSON.stringify(before), JSON.stringify({ ...changes, reason }), reason.slice(0, 1000));
  });
  return getVideoAttempt(id, "owner", true);
}
