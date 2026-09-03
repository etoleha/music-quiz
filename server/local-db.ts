import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

declare global {
  var musicQuizDatabase: DatabaseSync | undefined;
}

function createDatabase() {
  const localDataDirectory = join(process.cwd(), "data");
  const databasePath = process.env.QUIZ_DB_PATH ?? join(localDataDirectory, "quiz.sqlite");
  if (!process.env.QUIZ_DB_PATH) mkdirSync(localDataDirectory, { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      quiz_id TEXT NOT NULL,
      quiz_title TEXT NOT NULL,
      score INTEGER NOT NULL,
      max_score INTEGER NOT NULL,
      skipped INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attempt_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      track_key TEXT NOT NULL,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      artist_answer TEXT NOT NULL DEFAULT '',
      title_answer TEXT NOT NULL DEFAULT '',
      artist_point INTEGER NOT NULL DEFAULT 0,
      title_point INTEGER NOT NULL DEFAULT 0,
      load_failed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(attempt_id, track_key)
    );

    CREATE TABLE IF NOT EXISTS quiz_shares (
      token TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fragment_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      quiz_id TEXT NOT NULL,
      track_key TEXT NOT NULL,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      youtube_id TEXT NOT NULL,
      clip_start INTEGER NOT NULL,
      clip_duration INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(attempt_id, track_key)
    );

    CREATE INDEX IF NOT EXISTS idx_attempts_user_created
      ON attempts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt
      ON attempt_answers(attempt_id);
    CREATE INDEX IF NOT EXISTS idx_fragment_reports_track
      ON fragment_reports(track_key, created_at DESC);
    PRAGMA optimize;
  `);
  return database;
}

export function getLocalDb() {
  globalThis.musicQuizDatabase ??= createDatabase();
  return globalThis.musicQuizDatabase;
}

export function inTransaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
