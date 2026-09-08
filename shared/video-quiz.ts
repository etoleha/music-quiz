export type VideoField = { key: "artist" | "title"; label: string };
export type VideoQuestion = {
  id: string; number: number; start: number; close: number; reveal: number; answerStart?: number;
  fields: VideoField[]; chances: Array<{ start: number; end: number; points: number; musicEnd?: number }>;
};
export type VideoRound = { number: number; title: string; start: number; close: number; reveal: number; questions: VideoQuestion[] };
export type VideoEpisode = { id: string; title: string; duration: number; revision: string; rounds: VideoRound[] };
export type VideoDraft = { artist: string; title: string };
export type VideoAnswer = {
  draft: VideoDraft; locked: boolean; submitted: boolean; submittedAt: number | null;
  possible: number; points?: number; automaticPoints?: number; annulled?: boolean;
  correct?: VideoDraft; album?: string; year?: number; coverArtist?: string;
  links?: Array<{ label: string; url: string }>;
};
export type VideoAttempt = { id: string; quizId: string; name: string; position: number; score: number; maxScore: number; completed: boolean; answers: Record<string, VideoAnswer> };
export type VideoReport = { id: string; questionId: string; comment: string; conclusion: string; category: string; status: string; createdAt: string; attemptId: string; name: string };
export type VideoHistory = { id: string; playerId: string; quizId: string; name: string; score: number; maxScore: number; position: number; completed: boolean; createdAt: string };

// Watching results has its own cursor; it must not reuse or rewind the saved attempt.
export function historyPlayback(attempt: Pick<VideoAttempt, "completed" | "position">, guest: boolean) {
  const review = !guest || attempt.completed;
  return { review, position: review ? 0 : attempt.position };
}

export function questionMaximum(q: VideoQuestion) { return q.chances.length ? 2 : q.fields.length === 2 ? 1.5 : 1; }
export function chanceAt(q: VideoQuestion, position: number) { return q.chances.find(c => position >= c.start && position < c.end); }
export function chanceClock(q: VideoQuestion, position: number) {
  const chance = chanceAt(q, position);
  if (!chance) return undefined;
  const musicEnd = chance.musicEnd;
  const music = musicEnd !== undefined && position < musicEnd;
  return { points: chance.points, phase: music ? "music" : musicEnd !== undefined ? "submit" : "chance",
    seconds: Math.max(0, Math.ceil((music ? musicEnd : chance.end) - position)) };
}
export function roundAt(episode: VideoEpisode, position: number) {
  return [...episode.rounds].reverse().find(r => position >= r.start) ?? episode.rounds[0];
}
export function nextAnswerAt(episode: VideoEpisode, position: number) {
  return roundAt(episode, position)?.questions
    .map(q => q.answerStart ?? q.reveal)
    .find(at => at > position + .05);
}
