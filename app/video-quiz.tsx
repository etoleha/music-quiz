"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Film, LockKeyhole, Check, Flag, Share2, ArrowLeft, Users, Trophy, Clock3, Send, X, RotateCcw } from "lucide-react";
import { chanceAt, questionMaximum, roundAt, nextAnswerAt, type VideoEpisode, type VideoAttempt, type VideoDraft, type VideoHistory, type VideoReport } from "../shared/video-quiz";
import "./video-quiz.css";

const time = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
const points = (n: number) => n.toLocaleString("ru-RU");
type Dialog = { kind: "report" | "correct"; questionId: string; points?: number; annulled?: boolean; global?: boolean };

export default function VideoQuiz({ shareToken }: { shareToken?: string }) {
  const guest = !!shareToken;
  const api = guest ? `/g/video-api?share=${encodeURIComponent(shareToken!)}` : "/api/video-quizzes";
  const [catalogue, setCatalogue] = useState<VideoEpisode[]>([]);
  const [history, setHistory] = useState<VideoHistory[]>([]);
  const [reports, setReports] = useState<VideoReport[]>([]);
  const [attempt, setAttempt] = useState<VideoAttempt | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [position, setPosition] = useState(0);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [review, setReview] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("accepted-answer");
  const [jumping, setJumping] = useState(false);
  const dialogSubmitting = useRef(false);
  const dialogOpen = !!dialog;
  const [comment, setComment] = useState("");
  const [drafts, setDrafts] = useState<Record<string, VideoDraft>>({});
  const video = useRef<HTMLVideoElement>(null);
  const gameRef = useRef<HTMLElement>(null), playerRef = useRef<HTMLDivElement>(null), workspaceRef = useRef<HTMLDivElement>(null), sheetRef = useRef<HTMLElement>(null);
  const draftRef = useRef(drafts), attemptRef = useRef(attempt);
  const queue = useRef(Promise.resolve());
  const lastSync = useRef(0), highWater = useRef(0), boundaryBusy = useRef(false);
  const playIntent = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const modalRef = useRef<HTMLElement>(null), dialogOrigin = useRef<HTMLElement | null>(null);
  const unmountSave = useRef<() => void>(() => {});
  draftRef.current = drafts; attemptRef.current = attempt;
  const episode = catalogue.find(e => e.id === attempt?.quizId);
  const currentRound = episode ? roundAt(episode, position) : null;
  const round = episode?.rounds.find(r => r.number === selectedRound) || currentRound;

  const request = useCallback(async (body?: Record<string, unknown>) => {
    const response = await fetch(api, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" } : { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось связаться с сервером");
    return result;
  }, [api]);
  const refresh = useCallback(async () => {
    try { const data = await request(); setCatalogue(data.episodes); setHistory(data.history); setReports(data.reports); if (data.name) setName(data.name); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); unmountSave.current(); }, []);

  function applyAttempt(a: VideoAttempt, initial = false) {
    setAttempt(a); attemptRef.current = a;
    if (initial) {
      let local: Record<string, VideoDraft> = {};
      try { local = JSON.parse(localStorage.getItem(`video-quiz:${a.id}`) || "{}"); } catch { /* browser storage can be disabled */ }
      const next = Object.fromEntries(Object.entries(a.answers).map(([id, answer]) => [id, !answer.locked && local[id] ? local[id] : answer.draft]));
      setDrafts(next); draftRef.current = next; setPosition(a.position); highWater.current = a.position;
    } else {
      setDrafts(old => Object.fromEntries(Object.entries(a.answers).map(([id, answer]) => [id, answer.locked ? answer.draft : old[id] || answer.draft])));
    }
  }
  const sync = useCallback((at: number, questionId?: string): Promise<void> => {
    const a = attemptRef.current; if (!a || review) return Promise.resolve();
    const captured = { ...draftRef.current };
    const run = async () => {
      if (attemptRef.current?.id !== a.id) return;
      setSaving(true);
      try {
        const data = await request({ action: questionId ? "submit" : "sync", attemptId: a.id, position: at, drafts: captured, questionId });
        if (attemptRef.current?.id === a.id) { applyAttempt(data.attempt); setError(""); }
      } catch (e) { if (attemptRef.current?.id === a.id) { playIntent.current = false; video.current?.pause(); setError((e as Error).message); } throw e; }
      finally { setSaving(false); }
    };
    const pending = queue.current.catch(() => {}).then(run);
    queue.current = pending.catch(() => {});
    return pending;
  }, [request, review]);
  unmountSave.current = () => {
    const a = attemptRef.current;
    if (!a || review) return;
    const at = video.current?.currentTime ?? highWater.current;
    playIntent.current = false; video.current?.pause();
    void fetch(api, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", attemptId: a.id, position: at, drafts: draftRef.current }) }).catch(() => {});
    attemptRef.current = null;
  };
  function openDialog(value: Dialog) { dialogOrigin.current = document.activeElement as HTMLElement; setCorrectionReason("accepted-answer"); setDialog(value); }
  function keepFieldVisible(field: HTMLInputElement) {
    if (document.activeElement !== field) return;
    if (sheetRef.current && getComputedStyle(sheetRef.current).overflowY === "auto") {
      field.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      return;
    }
    const rect = field.getBoundingClientRect();
    const player = playerRef.current?.getBoundingClientRect();
    const overlapsPlayer = player && rect.left < player.right && rect.right > player.left;
    const top = Math.min(overlapsPlayer ? player.bottom + 12 : 12, window.innerHeight - rect.height - 12);
    if (rect.top < top) window.scrollBy({ top: rect.top - top, behavior: "instant" });
    else if (rect.bottom > window.innerHeight - 12) window.scrollBy({ top: rect.bottom - window.innerHeight + 12, behavior: "instant" });
  }
  useEffect(() => {
    if (!attempt?.id || !playerRef.current || !workspaceRef.current) return;
    window.scrollTo({ top: 0, behavior: "instant" });
    const updateSize = () => {
      const player = playerRef.current, workspace = workspaceRef.current;
      if (!player || !workspace) return;
      gameRef.current?.style.setProperty("--vq-player-space", `${player.offsetHeight + 20}px`);
      const controls = [".vq-round-nav", ".vq-player-controls", ".vq-jump-controls"].reduce((height, selector) => height + (player.querySelector<HTMLElement>(selector)?.offsetHeight || 0), 20);
      gameRef.current?.style.setProperty("--vq-fit-width", `${Math.max(60, workspace.clientHeight - controls) * 16 / 9}px`);
      const field = document.activeElement;
      if (field instanceof HTMLInputElement && field.closest(".vq-fields")) requestAnimationFrame(() => keepFieldVisible(field));
    };
    const size = new ResizeObserver(updateSize);
    size.observe(playerRef.current); size.observe(workspaceRef.current);
    updateSize();
    return () => size.disconnect();
  }, [attempt?.id]);
  useEffect(() => { if (sheetRef.current) sheetRef.current.scrollTop = 0; }, [round?.number]);
  const activeQuestionId = round?.questions.find((q, i) => position >= q.start && position < (round.questions[i + 1]?.start ?? round.close))?.id;
  useEffect(() => {
    if (!playing || selectedRound !== null || !activeQuestionId || document.activeElement?.matches("input,textarea,select")) return;
    const row = document.getElementById(`video-question-${activeQuestionId}`);
    if (!row || !playerRef.current) return;
    if (sheetRef.current && getComputedStyle(sheetRef.current).overflowY === "auto") {
      const rect = row.getBoundingClientRect(), panel = sheetRef.current.getBoundingClientRect();
      if (rect.top < panel.top || rect.bottom > panel.bottom) row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      return;
    }
    const rect = row.getBoundingClientRect(), player = playerRef.current.getBoundingClientRect();
    const bottom = rect.left < player.right && rect.right > player.left ? player.bottom : 0;
    if (rect.top < bottom + 12 || rect.bottom > window.innerHeight - 16) row.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [activeQuestionId, playing, selectedRound]);
  useEffect(() => {
    if (!dialogOpen) return;
    playIntent.current = false; video.current?.pause();
    void sync(video.current?.currentTime ?? highWater.current).catch(() => {});
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!dialogSubmitting.current) setDialog(null); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),textarea,input,select") || []);
      if (!controls.length) return;
      const first = controls[0], last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", trap);
    return () => { window.removeEventListener("keydown", trap); dialogOrigin.current?.focus(); };
  }, [dialogOpen, sync]);

  const togglePlayback = useCallback(() => {
    const v = video.current; if (!v || review) return;
    if (boundaryBusy.current) { playIntent.current = false; v.pause(); return; }
    if (v.paused) { playIntent.current = true; setSelectedRound(null); void v.play().catch(() => setError("Нажмите воспроизведение ещё раз")); }
    else { playIntent.current = false; v.pause(); void sync(v.currentTime).catch(() => {}); }
  }, [review, sync]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "F2" && !dialog && !e.repeat) { e.preventDefault(); togglePlayback(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [togglePlayback, dialog]);

  async function begin(id: string, fresh = false) {
    if (debounce.current) clearTimeout(debounce.current);
    playIntent.current = false; video.current?.pause(); attemptRef.current = null;
    setLoading(true); setError(""); setReview(false);
    try { const data = await request({ action: "start", quizId: id, name, fresh }); if (data.episode) setCatalogue(old => old.map(e => e.id === id ? data.episode : e)); applyAttempt(data.attempt, true); setSelectedRound(null); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  async function openHistory(h: VideoHistory) {
    try {
      const data = await request({ action: guest ? "open" : "review", attemptId: h.id });
      setReview(!guest || h.completed);
      if (data.episode) setCatalogue(old => old.map(e => e.id === h.quizId ? data.episode : e));
      applyAttempt(data.attempt, true); setSelectedRound(h.completed || !guest ? 1 : null);
    } catch (e) { setError((e as Error).message); }
  }
  function change(id: string, key: "artist" | "title", value: string) {
    const next = { ...draftRef.current, [id]: { ...(draftRef.current[id] || { artist: "", title: "" }), [key]: value } };
    draftRef.current = next; setDrafts(next);
    try { if (attempt) localStorage.setItem(`video-quiz:${attempt.id}`, JSON.stringify(next)); } catch { /* server save remains available */ }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void sync(video.current?.currentTime ?? position).catch(() => {}); }, 400);
  }
  function progress() {
    const v = video.current; if (!v || !episode || review || boundaryBusy.current) return;
    const at = v.currentTime;
    // Stop at a deadline until the latest draft is safely frozen. No internal breaks in the blitz.
    const crossings = episode.rounds.flatMap(r => r.questions).filter(q => !attemptRef.current?.answers[q.id]?.locked && q.close > highWater.current && q.close <= at);
    if (crossings.length) {
      const cut = Math.min(...crossings.map(q => q.close)); const resume = playIntent.current; const expectedId = attemptRef.current?.id;
      boundaryBusy.current = true; v.pause(); v.currentTime = cut; highWater.current = cut; setPosition(cut);
      void sync(cut).then(() => { if (resume && playIntent.current && attemptRef.current?.id === expectedId) return v.play(); }).catch(() => {}).finally(() => { boundaryBusy.current = false; });
      return;
    }
    highWater.current = Math.max(highWater.current, at); setPosition(at);
    if (Date.now() - lastSync.current > 1000) { lastSync.current = Date.now(); void sync(at).catch(() => {}); }
  }
  async function submit(questionId: string) {
    const v = video.current; if (!v) return;
    const at = v.currentTime, resume = playIntent.current, expectedId = attemptRef.current?.id; boundaryBusy.current = true; v.pause();
    try { await sync(at, questionId); setNotice("Ответ отправлен. Баллы появятся при раскрытии."); if (resume && playIntent.current && attemptRef.current?.id === expectedId) await v.play(); } catch { /* keep the player paused for retry */ } finally { boundaryBusy.current = false; }
  }
  async function jump(at: number) {
    const a = attemptRef.current, v = video.current;
    if (!a || !v || boundaryBusy.current || dialogSubmitting.current) return;
    if (debounce.current) clearTimeout(debounce.current);
    const resume = playIntent.current;
    boundaryBusy.current = true; setJumping(true); v.pause();
    try {
      await queue.current;
      if (attemptRef.current?.id !== a.id) return;
      if (!review && at > highWater.current) {
        const data = await request({ action: "jump", attemptId: a.id, position: at, drafts: draftRef.current });
        if (attemptRef.current?.id !== a.id) return;
        applyAttempt(data.attempt); highWater.current = Math.max(highWater.current, data.attempt.position);
      }
      v.currentTime = at; setPosition(at); setSelectedRound(null); setError("");
      if (resume && playIntent.current && !review) await v.play();
    } catch (e) { playIntent.current = false; setError((e as Error).message); }
    finally { boundaryBusy.current = false; setJumping(false); }
  }
  async function leave() { if (debounce.current) clearTimeout(debounce.current); playIntent.current = false; video.current?.pause(); if (!review) await sync(video.current?.currentTime ?? position).catch(() => {}); attemptRef.current = null; setAttempt(null); setReview(false); void refresh(); }
  async function share(id: string) {
    try { const data = await request({ action: "share", quizId: id }); const link = `${location.origin}/g/video/${data.token}`; await navigator.clipboard.writeText(link); setNotice("Гостевая ссылка скопирована"); }
    catch (e) { setError((e as Error).message); }
  }
  async function saveDialog() {
    if (!dialog || !attempt || dialogSubmitting.current) return;
    dialogSubmitting.current = true; setDialogSaving(true);
    try {
      const data = await request({ action: dialog.kind, attemptId: attempt.id, ...dialog, comment, reason: comment, reasonCode: dialog.kind === "correct" && dialog.points !== undefined ? correctionReason : undefined });
      if (attemptRef.current?.id !== attempt.id) return;
      if (data.attempt) applyAttempt(data.attempt);
      setNotice(dialog.kind === "report" ? `Комментарий сохранён. Авторазбор: ${data.conclusion}` : "Результат пересчитан. Причина сохранена в истории правок.");
      setDialog(null); setComment("");
    } catch (e) { setError((e as Error).message); }
    finally { dialogSubmitting.current = false; setDialogSaving(false); }
  }

  const alerts = <>{error && <div className="vq-alert" role="alert">{error}{attempt && !review && <button onClick={() => void sync(video.current?.currentTime ?? position).catch(() => {})}>Повторить сохранение</button>}</div>}{notice && <div className="vq-notice" role="status">{notice}<button aria-label="Скрыть уведомление" onClick={() => setNotice("")}><X size={16} /></button></div>}</>;
  if (!attempt || !episode || !round) return <section className="vq-library">
    {alerts}<div className="section-heading"><div><p className="eyebrow">Смотри · вспоминай · отвечай</p><h1>Квиз на большом экране</h1></div><span className="vq-pill"><Film size={16} /> Видеоквизы</span></div>
    <div className="vq-intro"><div><span className="vq-kicker">ВЕЧЕР С ХОРОШЕЙ МУЗЫКОЙ</span><h2>Видео сверху.<br />Твои ответы — под ним.</h2><p>Заполняй бланк в своём темпе. Обычные раунды сдадутся сами, а F2 даст паузу, чтобы дописать мысль.</p><div className="vq-intro-tags"><span><LockKeyhole size={16} /> Ответы фиксируются</span><span><Trophy size={16} /> Баллы сохраняются</span></div></div><div className="vq-record"><span>ПРОСТО<br /><b>КВИЗ</b></span><i /></div></div>
    {guest && <label className="vq-name">Как тебя записать?<input value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Имя или название команды" /></label>}
    {loading ? <p role="status">Загружаю видеоквизы…</p> : <div className="vq-episodes">{catalogue.map(e => <article className="vq-episode" key={e.id}><div className="vq-episode-icon"><Film /></div><div><span className="vq-kicker">8 РАУНДОВ · 80 ВОПРОСОВ</span><h2>{e.title}</h2><p><Clock3 size={15} /> {time(e.duration)} <span>·</span> до {points(e.rounds.flatMap(r => r.questions).reduce((n, q) => n + questionMaximum(q), 0))} баллов</p></div><div className="vq-actions"><button className="vq-primary" onClick={() => void begin(e.id)}><Play size={17} /> {history.some(h => h.quizId === e.id && !h.completed) ? "Продолжить" : "Начать"}</button>{!guest && <button className="vq-icon-button" aria-label="Пригласить гостя" onClick={() => void share(e.id)}><Share2 size={18} /></button>}</div></article>)}</div>}
    <div className="vq-stat-grid"><article><Trophy /><strong>{points(history.reduce((n, h) => n + h.score, 0))}</strong><span>баллов в видеоквизах</span></article><article><Check /><strong>{history.filter(h => h.completed).length}</strong><span>завершённых прохождений</span></article><article><Users /><strong>{new Set(history.map(h => h.playerId)).size}</strong><span>{guest ? "игрок в этом браузере" : "игроков и команд"}</span></article></div>
    <section className="vq-history"><h2>Прохождения {guest ? "и результаты" : "всех игроков"}</h2>{history.length ? history.map(h => <button className="vq-history-row" key={h.id} onClick={() => void openHistory(h)}><span><b>{h.name}</b><small>{new Date(h.createdAt).toLocaleString("ru-RU")} · {h.completed ? "Завершён" : `Остановлен на ${time(h.position)}`}</small></span><strong>{points(h.score)} / {points(h.maxScore)}</strong></button>) : <p>Здесь появятся сохранённые результаты и незавершённые игры.</p>}</section>
    {!guest && !!reports.length && <section className="vq-history"><h2>Комментарии к вопросам</h2>{reports.map(r => <article className="vq-report" key={r.id}><span className="vq-pill">{r.questionId} · {r.status === "resolved" ? "Обработан" : "Ждёт ведущего"}</span><b>{r.name}</b><p>{r.comment}</p><small>Предварительный авторазбор: {r.conclusion}</small>{r.status !== "resolved" && <button onClick={() => void request({ action: "resolveReport", reportId: r.id }).then(refresh)}>Отметить обработанным</button>}</article>)}</section>}
  </section>;

  const activeChanceQuestion = round.questions.find(q => position >= q.start && position < q.close);
  const questionTime = episode.rounds.flatMap(r => r.questions.map(q => q.start)).find(at => at > position + .05);
  const answerTime = nextAnswerAt(episode, position);
  const media = guest ? `/g/video-media/${episode.id}?share=${encodeURIComponent(shareToken!)}` : `/api/video-media/${episode.id}`;
  const needsComment = dialog?.kind === "report" || dialog?.annulled !== undefined || correctionReason === "other";
  return <section className="vq-game" ref={gameRef}>
    <div className="vq-game-heading"><button className="vq-back" onClick={() => void leave()}><ArrowLeft size={17} /> К выпускам</button><span className="vq-pill">{review ? `Результаты · ${attempt.name}` : attempt.name}</span><span className="vq-save" role="status">{saving ? "Сохраняю…" : error ? "Не сохранено" : "Сохранено"}</span></div>
    {alerts}
    <div className="vq-play-workspace" ref={workspaceRef}>
    <div ref={playerRef} className="vq-player-layout">
    <nav className="vq-round-nav" aria-label="Бланки раундов">{episode.rounds.map(r => <button key={r.number} title={`Раунд ${r.number} · ${r.title}`} aria-label={`Раунд ${r.number} · ${r.title}`} aria-current={r.number === round.number ? "step" : undefined} className={r.number === round.number ? "active" : ""} disabled={jumping} onClick={() => void jump(r.start)}><span>{r.number}</span>{r.title}{attempt.answers[r.questions[0].id]?.points !== undefined && <Check size={13} />}</button>)}</nav>
    <div className="vq-player"><video key={attempt.id} ref={video} src={media} preload="metadata" playsInline onLoadedMetadata={() => { if (video.current) video.current.currentTime = attempt.position; }} onTimeUpdate={progress} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onSeeking={() => { const v = video.current; if (v && !review && v.currentTime > highWater.current + .3) v.currentTime = highWater.current; }} onRateChange={() => { if (video.current) video.current.playbackRate = 1; }} onEnded={() => { setPlaying(false); void sync(episode.duration).catch(() => {}); }} onError={() => setError("Видео недоступно. Проверьте загрузку файла на сервер и соединение.")} aria-label={episode.title} />
      <div className="vq-player-controls"><button className="vq-play" disabled={review || saving && boundaryBusy.current} onClick={togglePlayback} aria-label={playing ? "Пауза · F2" : "Воспроизвести · F2"}>{playing ? <Pause /> : <Play />}</button><span>{time(position)} <small>/ {time(episode.duration)}</small></span><input type="range" aria-label="Перемотка по просмотренной части" min={0} max={episode.duration} step={.04} value={position} disabled={review} onChange={e => { const v = video.current; if (v) { v.currentTime = Math.min(Number(e.target.value), highWater.current); setPosition(v.currentTime); } }} /><kbd>F2 — пауза</kbd></div>
    </div><div className="vq-jump-controls"><span className="vq-compact-score"><Trophy size={17} /> {points(attempt.score)} / {points(attempt.maxScore)}</span><button disabled={jumping || questionTime === undefined} onClick={() => questionTime !== undefined && void jump(questionTime)}><Play size={17} /> Следующий вопрос</button><button disabled={jumping || answerTime === undefined} onClick={() => answerTime !== undefined && void jump(answerTime)}><Check size={17} /> Следующий ответ</button>{attempt.completed && <button onClick={() => void begin(episode.id, true)}><RotateCcw size={15} /> Заново</button>}</div>
    </div>
    <section className="vq-sheet-panel" ref={sheetRef} aria-label={`Бланк раунда ${round.number}`}>
    <div className="vq-sheet-heading"><div><span className="vq-kicker">РАУНД {round.number}</span><h2>{round.title}</h2></div><span className="vq-pill">{position >= round.close ? <><LockKeyhole size={15} /> Приём закрыт</> : `До сдачи ${time(Math.max(0, round.close - position))}`}</span></div>
    {round.number === 7 && <p className="vq-navigation-note">Один ответ. Отправь кнопкой на выбранном шансе.</p>}
    {round.number === 7 && episode.id === "prosto-v3" && <p className="vq-rules-note">Шкала на сайте: 2 / 1 / 0,5. Озвучка в этом ролике относится к прежним правилам.</p>}
    <div className="vq-answer-sheet">{round.questions.map(q => {
      const answer = attempt.answers[q.id]; const revealed = answer.points !== undefined;
      const locked = review || answer.locked || Math.max(position, attempt.position) >= q.close;
      const questionEnd = round.questions[q.number]?.start ?? round.close;
      const active = q.chances.length ? activeChanceQuestion?.id === q.id : position >= q.start && position < questionEnd;
      const currentChance = chanceAt(q, Math.max(position, attempt.position, highWater.current));
      return <article id={`video-question-${q.id}`} key={q.id} className={`vq-answer-row ${active ? "is-active" : ""} ${revealed ? "is-revealed" : ""}`}><span className="vq-question-number">{String(q.number).padStart(2, "0")}</span><div className="vq-answer-content"><div className="vq-fields">{q.fields.map(field => <label key={field.key}><input autoComplete="off" spellCheck={false} maxLength={160} aria-label={`Вопрос ${q.number}: ${field.label}`} value={drafts[q.id]?.[field.key] || ""} disabled={locked || !!q.chances.length && !active} onFocus={e => { const input = e.currentTarget; requestAnimationFrame(() => keepFieldVisible(input)); }} onChange={e => change(q.id, field.key, e.target.value)} placeholder={field.label} /></label>)}</div>
        {q.chances.length > 0 && !revealed && <div className="vq-chance-line"><span>{answer.submitted ? `Отправлено на ${time(answer.submittedAt || 0)}` : locked ? "Ответ не отправлен" : currentChance ? `Сейчас можно получить ${points(currentChance.points)} балл${currentChance.points === 1 ? "" : "а"}` : "Ожидает своего фрагмента"}</span><button className="vq-primary" disabled={locked || !active || saving || !drafts[q.id]?.artist.trim()} onClick={() => void submit(q.id)}><Send size={14} /> Отправить</button></div>}
        {revealed && <div className="vq-reveal"><strong>{q.fields.map(f => answer.correct?.[f.key]).filter(Boolean).join(" — ")}</strong>{answer.coverArtist && <small>Кавер: {answer.coverArtist}</small>}<div className="vq-row-tools"><button onClick={() => { openDialog({ kind: "report", questionId: q.id }); setComment(""); }}><Flag size={14} /> Сообщить о проблеме</button>{!guest && <><select aria-label={`Исправить баллы за вопрос ${q.number}`} value={answer.points} onChange={e => { openDialog({ kind: "correct", questionId: q.id, points: Number(e.target.value) }); setComment(""); }}>{Array.from({ length: questionMaximum(q) * 2 + 1 }, (_, i) => i / 2).map(n => <option value={n} key={n}>{points(n)} балла</option>)}</select><button onClick={() => { openDialog({ kind: "correct", questionId: q.id, annulled: !answer.annulled }); setComment(""); }}>{answer.annulled ? "Вернуть вопрос" : "Аннулировать"}</button></>}</div></div>}
      </div><span className={`vq-row-points ${answer.annulled ? "void" : ""}`}>{revealed ? answer.annulled ? "×" : points(answer.points!) : locked ? <LockKeyhole size={16} /> : "·"}</span></article>;
    })}</div>
    </section>
    </div>
    {dialog && <div className="vq-modal-backdrop" onClick={() => { if (!dialogSubmitting.current) setDialog(null); }}>
      <section ref={modalRef} className="vq-modal" role="dialog" aria-modal="true" aria-labelledby="vq-dialog-title" onClick={e => e.stopPropagation()}>
        <button className="vq-modal-close" aria-label="Закрыть" disabled={dialogSaving} onClick={() => { if (!dialogSubmitting.current) setDialog(null); }}><X /></button>
        <h2 id="vq-dialog-title">{dialog.kind === "report" ? "Что не так с вопросом?" : "Исправить результат"}</h2>
        {dialog.kind === "correct" && dialog.points !== undefined ? <>
          <p>Новый результат: <strong>{points(dialog.points)} балла</strong></p>
          <label className="vq-reason">Причина<select autoFocus disabled={dialogSaving} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)}><option value="accepted-answer">Исполнитель или название всё-таки верны</option><option value="other">Другая причина</option></select></label>
        </> : <p>{dialog.kind === "report" ? "Комментарий сохранится с номером вопроса. Авторазбор подскажет, что проверить ведущему." : "Укажи причину — она сохранится вместе с изменением баллов."}</p>}
        {needsComment && <textarea autoFocus aria-label="Комментарий к исправлению" rows={4} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} placeholder={dialog.kind === "report" ? "Что не так с вопросом?" : "Почему меняем результат?"} />}
        {dialog.kind === "correct" && dialog.annulled !== undefined && <label className="vq-checkbox"><input type="checkbox" checked={!!dialog.global} onChange={e => setDialog({ ...dialog, global: e.target.checked })} /> Для всех игроков этого выпуска</label>}
        <button className="vq-primary" disabled={dialogSaving || needsComment && comment.trim().length < 3} onClick={() => void saveDialog()}>Сохранить</button>
      </section>
    </div>}
  </section>;
}
