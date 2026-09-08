export type VideoField = { key: "artist" | "title"; label: string };
export type VideoQuestion = {
  id: string; number: number; start: number; close: number; reveal: number; answerStart?: number;
  fields: VideoField[]; chances: Array<{ start: number; end: number; points: number }>;
};
export type VideoRound = { number: number; title: string; start: number; close: number; reveal: number; questions: VideoQuestion[] };
export type VideoEpisode = { id: string; title: string; duration: number; revision: string; rounds: VideoRound[] };
export type VideoDraft = { artist: string; title: string };
export type VideoAnswer = {
  draft: VideoDraft; locked: boolean; submitted: boolean; submittedAt: number | null;
  possible: number; points?: number; automaticPoints?: number; annulled?: boolean;
  correct?: VideoDraft; album?: string; year?: number; coverArtist?: string;
};
export type VideoAttempt = { id: string; quizId: string; name: string; position: number; score: number; maxScore: number; completed: boolean; answers: Record<string, VideoAnswer> };
export type VideoReport = { id: string; questionId: string; comment: string; conclusion: string; category: string; status: string; createdAt: string; attemptId: string; name: string };
export type VideoHistory = { id: string; playerId: string; quizId: string; name: string; score: number; maxScore: number; position: number; completed: boolean; createdAt: string };

export function questionMaximum(q: VideoQuestion) { return q.chances.length ? 2 : q.fields.length === 2 ? 1.5 : 1; }
export function chanceAt(q: VideoQuestion, position: number) { return q.chances.find(c => position >= c.start && position < c.end); }
export function roundAt(episode: VideoEpisode, position: number) {
  return [...episode.rounds].reverse().find(r => position >= r.start) ?? episode.rounds[0];
}
