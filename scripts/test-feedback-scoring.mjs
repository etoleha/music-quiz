import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  applyBadFragmentScoreRule,
  attemptTotals,
  restoreAutoAnnulledAnswer,
} from "../server/feedback-scoring.ts";

const database = new DatabaseSync(":memory:");
database.exec(`
  CREATE TABLE attempt_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL,
    track_key TEXT NOT NULL,
    artist_point INTEGER NOT NULL,
    title_point INTEGER NOT NULL,
    load_failed INTEGER NOT NULL DEFAULT 0
  );
`);
const insert = database.prepare(`INSERT INTO attempt_answers
  (attempt_id, track_key, artist_point, title_point, load_failed) VALUES (?, ?, ?, ?, 0)`);
insert.run("attempt", "wrong", 1, 0);
insert.run("attempt", "empty", 0, 0);
insert.run("attempt", "correct", 1, 1);

assert.deepEqual(applyBadFragmentScoreRule(database, "attempt", "wrong"), { loadFailed: true, autoAnnulled: true });
assert.deepEqual(applyBadFragmentScoreRule(database, "attempt", "empty"), { loadFailed: true, autoAnnulled: true });
assert.deepEqual(applyBadFragmentScoreRule(database, "attempt", "correct"), { loadFailed: false, autoAnnulled: false });
assert.deepEqual({ ...attemptTotals(database, "attempt") }, { score: 2, maxScore: 2, skipped: 2 });

restoreAutoAnnulledAnswer(database, "attempt", "wrong");
assert.deepEqual({ ...attemptTotals(database, "attempt") }, { score: 3, maxScore: 4, skipped: 1 });

console.log("feedback scoring tests passed");
