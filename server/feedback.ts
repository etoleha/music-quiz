import type { DatabaseSync } from "node:sqlite";
import { quizzes } from "../app/quiz-data";

type FragmentReportRow = {
  quizId: string;
  trackKey: string;
  youtubeId: string;
  clipStart: number;
  clipDuration: number;
};

export function getUnresolvedFragmentReportKeys(database: DatabaseSync, quizId?: string) {
  const reports = database.prepare(`SELECT DISTINCT quiz_id AS quizId, track_key AS trackKey,
    youtube_id AS youtubeId, clip_start AS clipStart, clip_duration AS clipDuration
    FROM fragment_reports`).all() as FragmentReportRow[];
  return new Set(reports.filter((report) => {
    if (quizId && report.quizId !== quizId) return false;
    const current = quizzes.find((quiz) => quiz.id === report.quizId)?.tracks.find((track) => track.key === report.trackKey);
    return current && current.youtubeId === report.youtubeId && current.start === report.clipStart && current.duration === report.clipDuration;
  }).map((report) => report.trackKey));
}
