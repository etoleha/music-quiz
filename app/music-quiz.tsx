"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Check, ChevronRight, CirclePlay, ExternalLink, Headphones, History, Library, RotateCcw, Share2, TriangleAlert, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getQuiz, quizzes, type Quiz, type Track } from "./quiz-data";
import { isAccepted } from "./scoring";

type Player = { loadVideoById(options: { videoId: string; startSeconds: number }): void; pauseVideo(): void; stopVideo(): void };
type Answer = { trackKey: string; artistAnswer: string; titleAnswer: string; loadFailed: boolean };
type Review = Answer & { track: Track; artistPoint: number; titlePoint: number };
type Attempt = { id: string; quizId: string; quizTitle: string; score: number; maxScore: number; skipped: number; createdAt: string };
type WeakTrack = { trackKey: string; artist: string; title: string; misses: number };

declare global {
  interface Window {
    YT?: { Player: new (element: string, options: Record<string, unknown>) => Player; PlayerState: { PLAYING: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const shuffle = <T,>(items: T[]) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

const titleWordCount = (title: string) => title.trim().split(/\s+/).filter(Boolean).length;

const wordForm = (count: number) => {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "слов";
  const last = count % 10;
  if (last === 1) return "слово";
  if (last >= 2 && last <= 4) return "слова";
  return "слов";
};

type MusicQuizProps = {
  initialQuizId?: string;
  guestMode?: boolean;
  comparison?: {
    score: number;
    maxScore: number;
    answers: Array<{ trackKey: string; points: number; loadFailed: boolean }>;
  } | null;
};

export default function MusicQuiz({ initialQuizId, guestMode = false, comparison = null }: MusicQuizProps = {}) {
  const [screen, setScreen] = useState<"home" | "quiz" | "result">("home");
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [order, setOrder] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [tries, setTries] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [review, setReview] = useState<Review[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewPlayingKey, setReviewPlayingKey] = useState<string | null>(null);
  const [score, setScore] = useState({ value: 0, max: 0, skipped: 0 });
  const [currentAttemptId, setCurrentAttemptId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sharedQuizId, setSharedQuizId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [weakTracks, setWeakTracks] = useState<WeakTrack[]>([]);
  const player = useRef<Player | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triesRef = useRef(2);
  const playingRef = useRef(false);
  const answersRef = useRef<Answer[]>([]);
  const submissionLocked = useRef(false);
  const autoplayedTrack = useRef<string | null>(null);
  const artistInput = useRef<HTMLInputElement | null>(null);
  const titleInput = useRef<HTMLInputElement | null>(null);
  const reviewPlayButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const correctionVersions = useRef<Record<string, number>>({});
  const pendingCorrections = useRef(0);
  const statsRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guestStarted = useRef(false);
  const current = order[index];

  const loadStats = useCallback(async () => {
    if (guestMode) return;
    try {
      const response = await fetch("/api/stats");
      if (!response.ok) return;
      const data = await response.json() as { attempts: Attempt[]; weakTracks: WeakTrack[] };
      setAttempts(data.attempts);
      setWeakTracks(data.weakTracks);
    } catch { /* The quiz stays usable without stats. */ }
  }, [guestMode]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => {
    if (window.YT?.Player) { setReady(true); return; }
    window.onYouTubeIframeAPIReady = () => setReady(true);
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (!ready || player.current || !window.YT) return;
    let host = document.getElementById("youtube-player-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "youtube-player-host";
      host.className = "youtube-player";
      document.body.appendChild(host);
    }
    player.current = new window.YT.Player("youtube-player-host", {
      height: "135", width: "240",
      playerVars: { controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0 },
      events: {
        onReady: () => setPlayerReady(true),
        onStateChange: (event: { data: number }) => {
          if (event.data === window.YT?.PlayerState.PLAYING) {
            playingRef.current = true;
            setPlaying(true);
          }
        },
        onError: () => {
          playingRef.current = false;
          triesRef.current = 0;
          setPlaying(false);
          setTries(0);
        },
      },
    });
  }, [ready]);

  const playClip = useCallback(() => {
    if (!current || !player.current || !playerReady || triesRef.current < 1 || playingRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    triesRef.current -= 1;
    setTries(triesRef.current);
    playingRef.current = true;
    setPlaying(true);
    player.current.loadVideoById({ videoId: current.youtubeId, startSeconds: current.start });
    timer.current = setTimeout(() => {
      player.current?.pauseVideo();
      playingRef.current = false;
      setPlaying(false);
    }, current.duration * 1000);
  }, [current, playerReady]);

  const playReviewClip = useCallback((track: Track) => {
    if (!player.current || !playerReady) return;
    if (timer.current) clearTimeout(timer.current);
    playingRef.current = true;
    setPlaying(true);
    setReviewPlayingKey(track.key);
    player.current.loadVideoById({ videoId: track.youtubeId, startSeconds: track.start });
    timer.current = setTimeout(() => {
      player.current?.pauseVideo();
      playingRef.current = false;
      setPlaying(false);
      setReviewPlayingKey(null);
    }, track.duration * 1000);
  }, [playerReady]);

  const leaveResults = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    player.current?.stopVideo();
    playingRef.current = false;
    setPlaying(false);
    setReviewPlayingKey(null);
    setScreen("home");
  }, []);

  const begin = (quiz: Quiz) => {
    if (timer.current) clearTimeout(timer.current);
    player.current?.stopVideo();
    playingRef.current = false; triesRef.current = 2; answersRef.current = [];
    submissionLocked.current = false; autoplayedTrack.current = null;
    setActiveQuiz(quiz); setOrder(shuffle(quiz.tracks)); setIndex(0); setAnswers([]);
    setArtist(""); setTitle(""); setTries(2); setReview([]); setReviewIndex(0); setReviewPlayingKey(null); setCurrentAttemptId(null); setSaveState("idle"); setScreen("quiz");
  };

  useEffect(() => {
    if (!guestMode || guestStarted.current || !initialQuizId) return;
    const quiz = getQuiz(initialQuizId);
    if (!quiz) return;
    guestStarted.current = true;
    begin(quiz);
  }, [guestMode, initialQuizId]);

  const shareQuiz = async (quiz: Quiz) => {
    try {
      const response = await fetch("/api/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quizId: quiz.id }),
      });
      if (!response.ok) throw new Error("share failed");
      const { path } = await response.json() as { path: string };
      const url = `${window.location.origin}${path}`;
      if (navigator.share) {
        await navigator.share({ title: `Музыкальный квиз: ${quiz.title}`, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setSharedQuizId(quiz.id);
      window.setTimeout(() => setSharedQuizId((current) => current === quiz.id ? null : current), 1800);
    } catch { /* The native share sheet may be dismissed. */ }
  };

  const mistakeTracks = useMemo(() => {
    const weakKeys = new Set(weakTracks.map((item) => item.trackKey));
    const uniqueTracks = new Map(quizzes.flatMap((quiz) => quiz.tracks).map((track) => [track.key, track]));
    return [...uniqueTracks.values()].filter((track) => weakKeys.has(track.key));
  }, [weakTracks]);

  const beginMistakes = () => {
    if (!mistakeTracks.length) return;
    const tracks = shuffle(mistakeTracks).slice(0, 30);
    begin({
      id: "mistakes",
      title: "Работа над ошибками",
      subtitle: "Случайная выборка из песен, на которых раньше терялись баллы",
      level: "повторение",
      published: "",
      tracks,
    });
  };

  useEffect(() => {
    if (screen !== "quiz" || !current) return;
    if (timer.current) clearTimeout(timer.current);
    player.current?.stopVideo();
    playingRef.current = false;
    triesRef.current = 2;
    submissionLocked.current = false;
    setArtist(""); setTitle(""); setTries(2); setPlaying(false);
    const focusFrame = requestAnimationFrame(() => artistInput.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [current, screen]);

  useEffect(() => {
    if (screen !== "quiz" || !current || !playerReady || autoplayedTrack.current === current.key) return;
    autoplayedTrack.current = current.key;
    const autoplayTimer = setTimeout(() => playClip(), 0);
    return () => clearTimeout(autoplayTimer);
  }, [current, playerReady, playClip, screen]);

  const finish = async (finalAnswers: Answer[]) => {
    if (!activeQuiz) return;
    player.current?.stopVideo(); if (timer.current) clearTimeout(timer.current);
    const localReview = order.map((track) => {
      const answer = finalAnswers.find((item) => item.trackKey === track.key) ?? { trackKey: track.key, artistAnswer: "", titleAnswer: "", loadFailed: false };
      return { ...answer, track, artistPoint: answer.loadFailed ? 0 : Number(isAccepted(answer.artistAnswer, track.artistAliases)), titlePoint: answer.loadFailed ? 0 : Number(isAccepted(answer.titleAnswer, track.titleAliases)) };
    });
    const skipped = localReview.filter((item) => item.loadFailed).length;
    const value = localReview.reduce((sum, item) => sum + item.artistPoint + item.titlePoint, 0);
    const max = (order.length - skipped) * 2;
    setReview(localReview); setReviewIndex(0); setReviewPlayingKey(null); setScore({ value, max, skipped }); setCurrentAttemptId(null); setScreen("result");
    if (guestMode) {
      setSaveState("idle");
      return;
    }
    setSaveState("saving");
    try {
      const response = await fetch("/api/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quizId: activeQuiz.id, answers: finalAnswers }) });
      if (!response.ok) throw new Error("save failed");
      const data = await response.json() as { attemptId: string };
      setCurrentAttemptId(data.attemptId);
      setSaveState("saved"); await loadStats();
    } catch { setSaveState("error"); }
  };

  const correctResult = async (trackKey: string, change: { points?: number; annulled?: boolean }) => {
    if (!currentAttemptId) return;
    const previousReview = review;
    const version = (correctionVersions.current[trackKey] ?? 0) + 1;
    correctionVersions.current[trackKey] = version;
    const optimisticReview = review.map((item) => {
      if (item.trackKey !== trackKey) return item;
      if (change.points !== undefined) return {
        ...item,
        artistPoint: Math.min(change.points, 1),
        titlePoint: Math.max(change.points - 1, 0),
        loadFailed: false,
      };
      return { ...item, loadFailed: Boolean(change.annulled) };
    });
    const optimisticSkipped = optimisticReview.filter((item) => item.loadFailed).length;
    setReview(optimisticReview);
    setScore({
      value: optimisticReview.reduce((sum, item) => sum + (item.loadFailed ? 0 : item.artistPoint + item.titlePoint), 0),
      max: (optimisticReview.length - optimisticSkipped) * 2,
      skipped: optimisticSkipped,
    });
    pendingCorrections.current += 1;
    setSaveState("saving");
    let failed = false;
    try {
      const response = await fetch("/api/attempts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attemptId: currentAttemptId, trackKey, ...change }),
      });
      if (!response.ok) throw new Error("correction failed");
      const data = await response.json() as {
        score: number;
        maxScore: number;
        skipped: number;
        artistPoint: number;
        titlePoint: number;
        loadFailed: boolean;
      };
      if (correctionVersions.current[trackKey] === version) {
        setReview((items) => items.map((item) => item.trackKey === trackKey ? {
          ...item,
          artistPoint: data.artistPoint,
          titlePoint: data.titlePoint,
          loadFailed: data.loadFailed,
        } : item));
      }
      if (statsRefreshTimer.current) clearTimeout(statsRefreshTimer.current);
      statsRefreshTimer.current = setTimeout(() => void loadStats(), 500);
    } catch {
      failed = true;
      if (correctionVersions.current[trackKey] === version) {
        setReview(previousReview);
        const previousSkipped = previousReview.filter((item) => item.loadFailed).length;
        setScore({
          value: previousReview.reduce((sum, item) => sum + (item.loadFailed ? 0 : item.artistPoint + item.titlePoint), 0),
          max: (previousReview.length - previousSkipped) * 2,
          skipped: previousSkipped,
        });
      }
      setSaveState("error");
    } finally {
      pendingCorrections.current -= 1;
      if (pendingCorrections.current === 0 && !failed) setSaveState("saved");
    }
  };

  const submit = (options: { loadFailed?: boolean; artistAnswer?: string; titleAnswer?: string } = {}) => {
    if (!current || submissionLocked.current) return;
    submissionLocked.current = true;
    const next = [...answersRef.current, {
      trackKey: current.key,
      artistAnswer: options.artistAnswer ?? artist,
      titleAnswer: options.titleAnswer ?? title,
      loadFailed: options.loadFailed ?? false,
    }];
    answersRef.current = next;
    setAnswers(next);
    if (index + 1 < order.length) setIndex(index + 1); else void finish(next);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";

      if (screen === "quiz") {
        if (event.code === "Space" && (event.ctrlKey || !typing)) {
          event.preventDefault();
          playClip();
        } else if (event.altKey && event.code === "KeyN") {
          event.preventDefault();
          submit({ artistAnswer: "", titleAnswer: "" });
        } else if (event.altKey && event.code === "KeyL") {
          event.preventDefault();
          submit({ loadFailed: true });
        }
        return;
      }

      if (screen === "home" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.key === "0" && mistakeTracks.length) {
          event.preventDefault();
          beginMistakes();
          return;
        }
        const quizNumber = Number(event.key);
        if (quizNumber >= 1 && quizNumber <= quizzes.length) {
          event.preventDefault();
          begin(quizzes[quizNumber - 1]);
        }
      } else if (screen === "result" && activeQuiz) {
        if (event.altKey && event.code === "KeyR") {
          event.preventDefault();
          begin(activeQuiz);
        } else if (event.code === "Space" && event.ctrlKey && review[reviewIndex]) {
          event.preventDefault();
          playReviewClip(review[reviewIndex].track);
        } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && review.length) {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex = (reviewIndex + direction + review.length) % review.length;
          setReviewIndex(nextIndex);
          reviewPlayButtons.current[nextIndex]?.focus();
        } else if (event.key === "Escape") {
          event.preventDefault();
          leaveResults();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuiz, artist, index, leaveResults, mistakeTracks, order.length, playClip, playReviewClip, review, reviewIndex, screen, title]);

  const totalPoints = useMemo(() => attempts.reduce((sum, attempt) => sum + attempt.score, 0), [attempts]);
  const totalMax = useMemo(() => attempts.reduce((sum, attempt) => sum + attempt.maxScore, 0), [attempts]);
  const percentage = totalMax ? Math.round(totalPoints / totalMax * 100) : 0;

  if (screen === "quiz" && activeQuiz && current) {
    return <main className="shell quiz-shell">
      <header className="topbar"><button className="wordmark" onClick={() => setScreen("home")}>НЕ ПО ПРИПЕВУ</button><Badge variant="outline">{activeQuiz.title}</Badge></header>
      <Progress value={(index + 1) / order.length * 100} className="quiz-progress" />
      <section className="quiz-panel">
        <div className={`play-zone ${playing ? "is-playing" : ""}`}>
          <span className="question-number">{String(index + 1).padStart(2, "0")} / {order.length}</span><span className="clip-length">{current.duration} сек.</span>
          <div className="record" aria-hidden="true"><span /></div><div className="equalizer" aria-hidden="true">{Array.from({ length: 9 }).map((_, i) => <i key={i} />)}</div>
          <Button size="lg" className="play-button" onClick={playClip} disabled={tries < 1 || playing}><CirclePlay /> {playing ? "Играет…" : tries === 1 ? "Включить ещё раз" : tries === 0 ? "Фрагмент прослушан" : `Включить ${current.duration} секунд`}</Button>
          <p className="listen-count">Осталось прослушиваний: {tries} · Ctrl + пробел — повторить</p>
        </div>
        <div className="answer-zone"><p>Enter — перейти к названию и отправить ответ. Можно писать транслитом и с опечатками.</p>
          <div className="answer-fields"><label>{current.artistForm}<input ref={artistInput} value={artist} onChange={(event) => setArtist(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.repeat) { event.preventDefault(); titleInput.current?.focus(); } }} autoComplete="off" placeholder="Кто поёт?" /></label><label>Название — {titleWordCount(current.title)} {wordForm(titleWordCount(current.title))}<input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.repeat) { event.preventDefault(); submit(); } }} autoComplete="off" placeholder="Что за песня?" /></label></div>
          <div className="quiz-actions"><div><Button variant="ghost" onClick={() => submit({ artistAnswer: "", titleAnswer: "" })}>Не знаю · Alt+N</Button><Button variant="ghost" className="load-failed" onClick={() => submit({ loadFailed: true })}>Не загрузилось · Alt+L</Button></div><Button onClick={() => submit()}>Следующая · Enter <ChevronRight /></Button></div>
        </div>
      </section>
    </main>;
  }

  if (screen === "result") {
    const ownerAnswers = new Map(comparison?.answers.map((answer) => [answer.trackKey, answer]));
    return <main className="shell"><header className="topbar"><button className="wordmark" onClick={() => setScreen("home")}>НЕ ПО ПРИПЕВУ</button><Badge variant="outline">результат</Badge></header>
      <section className="result-card"><div className={`result-summary ${comparison ? "has-comparison" : ""}`}><div><small>{comparison ? "Ты" : ""}</small><div className="result-score">{score.value} <span>/ {score.max}</span></div></div>{comparison && <div className="owner-result"><small>Алексей</small><strong>{comparison.score} <span>/ {comparison.maxScore}</span></strong></div>}</div>
        {!guestMode && saveState === "error" && <p className="save-state error">Не удалось сохранить изменение</p>}
        <div className="review-list">{review.map((item, itemIndex) => { const points = item.artistPoint + item.titlePoint; const ownerAnswer = ownerAnswers.get(item.track.key); const isPlaying = reviewPlayingKey === item.track.key; return <article className={`review-row ${item.loadFailed ? "is-annulled" : ""} ${reviewIndex === itemIndex ? "is-selected" : ""}`} key={item.track.key}><b>{String(itemIndex + 1).padStart(2, "0")}</b><div><strong>{item.track.artist} — {item.track.title}</strong><small>{item.loadFailed ? "Аннулирован" : `${item.artistAnswer || "—"} · ${item.titleAnswer || "—"}`}</small></div><div className="row-scores"><span className={item.loadFailed ? "void" : points ? "points" : "zero"}>{item.loadFailed ? "—" : `${points}/2`}</span>{comparison && <span className="owner-points">{ownerAnswer?.loadFailed ? "—" : ownerAnswer ? `${ownerAnswer.points}/2` : "—"}</span>}</div><div className="review-controls"><Button ref={(element) => { reviewPlayButtons.current[itemIndex] = element; }} size="sm" variant="outline" className="review-play" disabled={!playerReady} aria-label={`Прослушать фрагмент ${item.track.artist} — ${item.track.title}`} onFocus={() => setReviewIndex(itemIndex)} onClick={() => { setReviewIndex(itemIndex); playReviewClip(item.track); }}><Volume2 /> {isPlaying ? "…" : `${item.track.duration} сек.`}</Button><a className="youtube-link" href={`https://www.youtube.com/watch?v=${item.track.youtubeId}`} target="_blank" rel="noreferrer" aria-label={`Открыть ${item.track.artist} — ${item.track.title} на YouTube`}><ExternalLink /> YouTube</a>{!guestMode && <><Button size="sm" variant="ghost" disabled={!currentAttemptId} onClick={() => void correctResult(item.trackKey, { annulled: !item.loadFailed })}>{item.loadFailed ? "Вернуть" : "Аннулировать"}</Button><div className="score-picker" role="group" aria-label={`Баллы за ${item.track.artist} — ${item.track.title}`}>{[0, 1, 2].map((value) => <button type="button" key={value} className={!item.loadFailed && points === value ? "is-selected" : ""} aria-pressed={!item.loadFailed && points === value} disabled={!currentAttemptId} onClick={() => void correctResult(item.trackKey, { points: value })}>{value}</button>)}</div></>}</div></article>; })}</div>
        <div className="result-actions">{!guestMode && <Button variant="outline" onClick={leaveResults}><Library /> Все квизы · Esc</Button>}{!guestMode && activeQuiz && <Button variant="outline" onClick={() => void shareQuiz(activeQuiz)}><Share2 /> {sharedQuizId === activeQuiz.id ? "Ссылка скопирована" : "Поделиться"}</Button>}<Button onClick={() => activeQuiz && begin(activeQuiz)}><RotateCcw /> Ещё раз · Alt+R</Button></div>
      </section>
    </main>;
  }

  return <main className="shell"><header className="topbar"><div className="wordmark">НЕ ПО ПРИПЕВУ</div><Badge variant="outline">личная коллекция</Badge></header>
    <Tabs defaultValue="quizzes" className="workspace"><TabsList className="nav-tabs"><TabsTrigger value="quizzes"><Library /> Квизы</TabsTrigger><TabsTrigger value="stats"><BarChart3 /> Статистика</TabsTrigger></TabsList>
      <TabsContent value="quizzes" className="tab-content"><div className="section-heading"><div><p className="eyebrow">Коллекция</p><h1>Выбери следующий заход</h1></div><div className="library-total">{quizzes.length}<small>квиза</small></div></div>
        <div className="quiz-grid"><article className="quiz-card mistakes-card"><div className="card-index">↻</div><div className="card-badges"><Badge>персональный</Badge><Badge variant="outline">до 30 треков</Badge></div><h2>Работа над ошибками</h2><p>{mistakeTracks.length ? `Случайная выборка из ${mistakeTracks.length} накопленных песен. При каждом запуске состав меняется.` : "Появится после первых ошибок в обычных квизах."}</p><div className="card-meta"><span><RotateCcw /> Случайный порядок</span></div><Button size="lg" disabled={!mistakeTracks.length} onClick={beginMistakes}>Начать · 0 <ChevronRight /></Button></article>{quizzes.map((quiz, quizIndex) => { const latest = attempts.find((attempt) => attempt.quizId === quiz.id); const min = Math.min(...quiz.tracks.map((item) => item.duration)); const max = Math.max(...quiz.tracks.map((item) => item.duration)); return <article className="quiz-card" key={quiz.id}><div className="card-index">0{quizzes.length - quizIndex}</div><div className="card-badges"><Badge>{quiz.level}</Badge><Badge variant="outline">{quiz.tracks.length} трека</Badge></div><h2>{quiz.title}</h2><p>{quiz.subtitle}</p><div className="card-meta"><span><Headphones /> {min}–{max} сек.</span>{latest && <span><Check /> Последний: {latest.score}/{latest.maxScore}</span>}</div><div className="card-actions"><Button size="lg" onClick={() => begin(quiz)}>Начать · {quizIndex + 1} <ChevronRight /></Button><Button size="icon" variant="outline" aria-label={`Поделиться квизом ${quiz.title}`} title="Поделиться" onClick={() => void shareQuiz(quiz)}>{sharedQuizId === quiz.id ? <Check /> : <Share2 />}</Button></div></article>; })}</div>
        <p className="collection-note">Новые подборки будут появляться здесь отдельными квизами. Старые результаты сохраняются.</p>
      </TabsContent>
      <TabsContent value="stats" className="tab-content"><div className="section-heading"><div><p className="eyebrow">За всё время</p><h1>Твоя музыкальная форма</h1></div></div><div className="stats-grid"><article className="stat-card accent"><strong>{percentage}%</strong><span>точность</span></article><article className="stat-card"><strong>{attempts.length}</strong><span>квизов пройдено</span></article><article className="stat-card"><strong>{totalPoints}</strong><span>баллов набрано</span></article></div>
        <div className="stats-columns"><section className="history-card"><h2><History /> История</h2>{attempts.length ? attempts.map((attempt) => <div className="history-row" key={attempt.id}><div><strong>{attempt.quizTitle}</strong><small>{new Date(`${attempt.createdAt.replace(" ", "T")}Z`).toLocaleDateString("ru-RU")}</small></div><b>{attempt.score}/{attempt.maxScore}</b></div>) : <p className="empty-copy">Первый результат появится после квиза.</p>}</section><section className="history-card"><h2><TriangleAlert /> На повторение</h2>{weakTracks.length ? weakTracks.slice(0, 12).map((item) => <div className="weak-row" key={item.trackKey}><div><strong>{item.artist}</strong><small>{item.title}</small></div><Badge variant="outline">ошибок: {item.misses}</Badge></div>) : <p className="empty-copy">Здесь накопятся песни, которые стоит повторить.</p>}</section></div>
      </TabsContent></Tabs>
  </main>;
}
