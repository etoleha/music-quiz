import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { register } from 'node:module';

// Exercise the real GET handler with an in-memory database and synthetic tracks.
// Regrading functions throw: restored manual scores must come only from SQLite.
const track = { key: 'track-one', artist: 'Fixture band', title: 'Fixture song',
  artistForm: 'Группа', artistAliases: ['Fixture band'], titleAliases: ['Fixture song'],
  youtubeId: 'fixture', start: 12, duration: 11 };
const fixtureQuiz = { id: 'fixture-quiz', title: 'Current catalogue title', tracks: [track] };
const loader = `
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const stubs = {
  '../../quiz-data': ${JSON.stringify(`const quiz = ${JSON.stringify(fixtureQuiz)}; export const quizzes = [quiz]; export const getQuiz = id => id === quiz.id ? quiz : undefined;`)},
  '../../scoring': 'export const isAccepted = () => { throw new Error("Unexpected regrade"); }; export const isArtistAccepted = isAccepted;',
  '../../../server/local-db': 'export const getLocalDb = () => globalThis.__attemptHistoryQaDb; export const inTransaction = () => { throw new Error("Unexpected write"); };',
  '../../../server/mistake-mastery': 'export const applyMistakeResult = () => { throw new Error("Unexpected mastery write"); }; export const rebuildMistakeMasteryForTrack = applyMistakeResult;',
  '../../../shared/score-policy.ts': 'export const trackMaxScore = 3; export const weightedAnswerScore = () => { throw new Error("Unexpected score recalculation"); }; export const scoreToAnswerPoints = weightedAnswerScore;'
};
export async function resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/app/api/attempts/route.ts') && specifier in stubs)
    return { url: 'data:text/javascript,' + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.endsWith('/app/api/attempts/route.ts')) return { format: 'module', shortCircuit: true,
    source: stripTypeScriptTypes(await readFile(new URL(url), 'utf8'), { mode: 'transform', sourceUrl: url }) };
  return next(url, context);
}`;
register('data:text/javascript,' + encodeURIComponent(loader), import.meta.url);
const database = new DatabaseSync(':memory:');
globalThis.__attemptHistoryQaDb = database;
database.exec(`
  CREATE TABLE attempts (id TEXT PRIMARY KEY, user_id TEXT, quiz_id TEXT, quiz_title TEXT,
    score REAL, max_score REAL, skipped INTEGER);
  CREATE TABLE attempt_answers (id INTEGER PRIMARY KEY, attempt_id TEXT, track_key TEXT,
    artist_answer TEXT, title_answer TEXT, artist_point REAL, title_point REAL,
    load_failed INTEGER, load_error_code INTEGER);
  INSERT INTO attempts VALUES ('owned', 'owner', 'fixture-quiz', 'Saved title', 2, 3, 0);
  INSERT INTO attempts VALUES ('foreign', 'guest', 'fixture-quiz', 'Private guest title', 3, 3, 0);
  INSERT INTO attempts VALUES ('legacy', 'owner', 'fixture-quiz', 'Legacy', 19, 60, 0);
  INSERT INTO attempts VALUES ('missing-track', 'owner', 'fixture-quiz', 'Removed track', 0, 3, 0);
  INSERT INTO attempts VALUES ('annulled', 'owner', 'mistakes', 'Saved repetition', 0, 0, 1);
  INSERT INTO attempt_answers VALUES (1, 'owned', 'track-one', 'Wrong but manually accepted', '', 1, 0, 0, NULL);
  INSERT INTO attempt_answers VALUES (2, 'foreign', 'track-one', 'Guest answer', 'Secret answer', 1, 1, 0, NULL);
  INSERT INTO attempt_answers VALUES (3, 'missing-track', 'removed-key', '', '', 0, 0, 0, NULL);
  INSERT INTO attempt_answers VALUES (4, 'annulled', 'track-one', '', '', 1, 1, 1, 150);
`);
const { GET } = await import('../app/api/attempts/route.ts');
const get = query => GET(new Request(`http://localhost/api/attempts${query}`));
try {
  const before = database.prepare('SELECT total_changes() AS n').get().n;
  for (const query of ['', '?attemptId=', '?attemptId=one&attemptId=two', '?attemptId=%27%20OR%201%3D1']) {
    assert.equal((await get(query)).status, 400, `Reject invalid query ${query}`);
  }
  for (const id of ['absent', 'foreign', 'legacy', 'missing-track']) {
    const response = await get(`?attemptId=${id}`);
    assert.equal(response.status, 404, `No disclosure or incomplete review for ${id}`);
    assert(!JSON.stringify(await response.json()).includes('Secret answer'));
  }
  const response = await get('?attemptId=owned');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    attemptId: 'owned', quizId: 'fixture-quiz', quizTitle: 'Saved title', score: 2, maxScore: 3, skipped: 0,
    review: [{ trackKey: 'track-one', artistAnswer: 'Wrong but manually accepted', titleAnswer: '',
      artistPoint: 1, titlePoint: 0, loadFailed: false, track }],
  });
  const annulled = await (await get('?attemptId=annulled')).json();
  assert.equal(annulled.review[0].loadFailed, true);
  assert.equal(annulled.review[0].loadErrorCode, 150);
  assert.equal(annulled.review[0].artistPoint, 1, 'Preserve stored points even when annulled');
  assert.equal(annulled.maxScore, 0);
  assert.equal(annulled.skipped, 1);
  assert.equal(database.prepare('SELECT total_changes() AS n').get().n, before, 'GET must never write');
  console.log('Attempt history GET: invalid IDs, ownership, legacy/missing data, manual scores, annulment and no-write checks passed.');
} finally {
  database.close();
  delete globalThis.__attemptHistoryQaDb;
}
