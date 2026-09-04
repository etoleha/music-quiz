import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backfillMistakeMastery } from "./mistake-mastery";

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
      reason TEXT NOT NULL DEFAULT 'bad-fragment',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(attempt_id, track_key)
    );

    CREATE TABLE IF NOT EXISTS track_info_cache (
      track_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mistake_mastery (
      track_key TEXT PRIMARY KEY,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      successes INTEGER NOT NULL DEFAULT 0,
      required_successes INTEGER NOT NULL DEFAULT 2,
      misses INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      last_error_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_attempts_user_created
      ON attempts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt
      ON attempt_answers(attempt_id);
    CREATE INDEX IF NOT EXISTS idx_fragment_reports_track
      ON fragment_reports(track_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_track_info_cache_expiry
      ON track_info_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_mistake_mastery_active
      ON mistake_mastery(active, successes, misses DESC);
    PRAGMA optimize;
  `);
  const fragmentReportColumns = database.prepare("PRAGMA table_info(fragment_reports)").all() as Array<{ name: string }>;
  if (!fragmentReportColumns.some(({ name }) => name === "reason")) {
    database.exec("ALTER TABLE fragment_reports ADD COLUMN reason TEXT NOT NULL DEFAULT 'bad-fragment'");
  }
  backfillMistakeMastery(database);
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
