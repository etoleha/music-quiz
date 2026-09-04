import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMistakeResult, rebuildMistakeMasteryForTrack } from "../server/mistake-mastery.ts";

const database = new DatabaseSync(":memory:");
database.exec(`
  CREATE TABLE attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE attempt_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL,
    track_key TEXT NOT NULL,
    artist TEXT NOT NULL,
    title TEXT NOT NULL,
    artist_point INTEGER NOT NULL,
    title_point INTEGER NOT NULL,
    load_failed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE mistake_mastery (
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
`);

const result = (artistPoint, titlePoint, loadFailed = false) => ({
  trackKey: "artist—song",
  artist: "Artist",
  title: "Song",
  artistPoint,
  titlePoint,
  loadFailed,
});
const mastery = () => ({ ...database.prepare(`SELECT successes, required_successes AS requiredSuccesses,
  misses, active FROM mistake_mastery WHERE track_key = 'artist—song'`).get() });

applyMistakeResult(database, result(0, 1));
assert.deepEqual(mastery(), { successes: 0, requiredSuccesses: 2, misses: 1, active: 1 });
applyMistakeResult(database, result(1, 1));
assert.deepEqual(mastery(), { successes: 1, requiredSuccesses: 2, misses: 1, active: 1 });
applyMistakeResult(database, result(1, 0));
assert.deepEqual(mastery(), { successes: 0, requiredSuccesses: 2, misses: 2, active: 1 });
applyMistakeResult(database, result(1, 1));
applyMistakeResult(database, result(1, 1));
assert.deepEqual(mastery(), { successes: 2, requiredSuccesses: 2, misses: 2, active: 0 });
applyMistakeResult(database, result(1, 1));
assert.deepEqual(mastery(), { successes: 2, requiredSuccesses: 2, misses: 2, active: 0 });
applyMistakeResult(database, result(0, 0, true));
assert.deepEqual(mastery(), { successes: 2, requiredSuccesses: 2, misses: 2, active: 0 });

database.prepare("INSERT INTO attempts (id, user_id, created_at) VALUES (?, 'owner', ?)").run("a1", "2026-01-01 10:00:00");
database.prepare("INSERT INTO attempts (id, user_id, created_at) VALUES (?, 'owner', ?)").run("a2", "2026-01-02 10:00:00");
database.prepare("INSERT INTO attempt_answers (attempt_id, track_key, artist, title, artist_point, title_point) VALUES (?, ?, ?, ?, ?, ?)")
  .run("a1", "artist—song", "Artist", "Song", 0, 0);
database.prepare("INSERT INTO attempt_answers (attempt_id, track_key, artist, title, artist_point, title_point) VALUES (?, ?, ?, ?, ?, ?)")
  .run("a2", "artist—song", "Artist", "Song", 1, 1);
rebuildMistakeMasteryForTrack(database, "artist—song");
assert.deepEqual(mastery(), { successes: 1, requiredSuccesses: 2, misses: 1, active: 1 });

console.log("mistake mastery tests passed");
