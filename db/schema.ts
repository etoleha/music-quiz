import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  quizId: text("quiz_id").notNull(),
  quizTitle: text("quiz_title").notNull(),
  score: integer("score").notNull(),
  maxScore: integer("max_score").notNull(),
  skipped: integer("skipped").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const attemptAnswers = sqliteTable("attempt_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  attemptId: text("attempt_id").notNull().references(() => attempts.id),
  trackKey: text("track_key").notNull(),
  artist: text("artist").notNull(),
  title: text("title").notNull(),
  artistAnswer: text("artist_answer").notNull().default(""),
  titleAnswer: text("title_answer").notNull().default(""),
  artistPoint: integer("artist_point").notNull().default(0),
  titlePoint: integer("title_point").notNull().default(0),
  loadFailed: integer("load_failed", { mode: "boolean" }).notNull().default(false),
});

export const fragmentReports = sqliteTable("fragment_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  attemptId: text("attempt_id").notNull().references(() => attempts.id),
  quizId: text("quiz_id").notNull(),
  trackKey: text("track_key").notNull(),
  artist: text("artist").notNull(),
  title: text("title").notNull(),
  youtubeId: text("youtube_id").notNull(),
  clipStart: integer("clip_start").notNull(),
  clipDuration: integer("clip_duration").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const trackInfoCache = sqliteTable("track_info_cache", {
  trackKey: text("track_key").primaryKey(),
  payloadJson: text("payload_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
});
