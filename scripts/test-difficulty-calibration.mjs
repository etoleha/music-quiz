import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { calibrateDifficulty } from "../shared/difficulty-calibration.ts";
import { difficultyCalibration } from "../server/difficulty-calibration.ts";

const easy = calibrateDifficulty({ attempts: 20, artistSuccesses: 18, titleSuccesses: 15 });
const hard = calibrateDifficulty({ attempts: 20, artistSuccesses: 4, titleSuccesses: 2 });
assert.ok(easy.difficulty < hard.difficulty);
assert.equal(calibrateDifficulty({ attempts: 0, artistSuccesses: 0, titleSuccesses: 0 }).difficulty, 50);

const database = new DatabaseSync(":memory:");
database.exec(`
  CREATE TABLE attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
  CREATE TABLE attempt_answers (
    attempt_id TEXT NOT NULL, track_key TEXT NOT NULL, artist TEXT NOT NULL, title TEXT NOT NULL,
    artist_point INTEGER NOT NULL, title_point INTEGER NOT NULL, load_failed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE fragment_reports (attempt_id TEXT NOT NULL, track_key TEXT NOT NULL, reason TEXT NOT NULL);
  INSERT INTO attempts VALUES ('a1', 'owner'), ('a2', 'owner'), ('guest', 'guest');
  INSERT INTO attempt_answers VALUES
    ('a1', 'track', 'Ёлка', 'Песня', 1, 0, 0),
    ('a2', 'track', 'Ёлка', 'Песня', 0, 0, 0),
    ('guest', 'track', 'Ёлка', 'Песня', 1, 1, 0),
    ('a2', 'broken', 'Другой', 'Сбой', 0, 0, 1);
`);
const report = difficultyCalibration(database);
assert.equal(report.tracks.length, 1);
assert.equal(report.tracks[0].attempts, 2);
assert.deepEqual(report.tracks[0].outcomes, { bothCorrect: 0, artistOnly: 1, titleOnly: 0, neither: 1 });
assert.equal(report.artists[0].artistKey, "елка");
assert.equal(report.policy.artistWeight, 2);

database.prepare("UPDATE attempt_answers SET artist_point = 1, title_point = 1 WHERE attempt_id = 'a2' AND track_key = 'track'").run();
const correctedReport = difficultyCalibration(database);
assert.equal(correctedReport.tracks[0].artistSuccesses, 2);
assert.equal(correctedReport.tracks[0].titleSuccesses, 1);
assert.deepEqual(correctedReport.tracks[0].outcomes, { bothCorrect: 1, artistOnly: 1, titleOnly: 0, neither: 0 });
assert.ok(correctedReport.tracks[0].difficulty < report.tracks[0].difficulty);
console.log("difficulty calibration tests passed");
