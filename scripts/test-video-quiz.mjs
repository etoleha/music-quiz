import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

// Tests load the actual TS server modules, while fixtures and SQLite live only
// in an owned temporary directory. No production manifest or DB is imported.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const previousCwd = process.cwd(), previousDb = process.env.QUIZ_DB_PATH, previousMedia = process.env.VIDEO_QUIZ_MEDIA_DIR;
const temporary = mkdtempSync(join(tmpdir(), 'music-video-quiz-test-'));
assert(temporary.startsWith(resolve(tmpdir()) + sep));
process.env.QUIZ_DB_PATH = join(temporary, 'isolated.sqlite');
process.env.VIDEO_QUIZ_MEDIA_DIR = join(temporary, 'media');
assert.equal(dirname(process.env.QUIZ_DB_PATH), temporary);
mkdirSync(join(temporary, 'server/video-data'), { recursive: true });
mkdirSync(process.env.VIDEO_QUIZ_MEDIA_DIR);
writeFileSync(join(process.env.VIDEO_QUIZ_MEDIA_DIR, 'fixture.mp4'), Buffer.from('0123456789abcdef'));
const loader = `
 import {readFile} from 'node:fs/promises';
 import {stripTypeScriptTypes} from 'node:module';
 export async function resolve(s,c,next) {
  try { return await next(s,c); } catch(e) {
   if(e.code==='ERR_MODULE_NOT_FOUND' && (s.startsWith('./')||s.startsWith('../')||s==='next/server')) {
    for(const ext of ['.ts','.js']) { try {return await next(s+ext,c);} catch {} }
   } throw e;
  }
 }
 export async function load(u,c,next) {
  if(u.startsWith('file:')&&u.endsWith('.ts')) return {format:'module',shortCircuit:true,source:stripTypeScriptTypes(await readFile(new URL(u),'utf8'),{mode:'transform',sourceUrl:u})};
  return next(u,c);
 }`;
register('data:text/javascript,' + encodeURIComponent(loader), import.meta.url);
const draft = (artist = '', title = '') => ({ artist, title });
const baseQuestion = { start: 2, close: 30, reveal: 35, chances: [], aliases: { artist: [], title: [] }, artistParts: [], correct: draft('Северный ветер', 'Тестовая мелодия') };
const pair = { ...baseQuestion, id: 'pair', number: 1, fields: [{ key: 'artist', label: 'Исполнители' }, { key: 'title', label: 'Песня' }], correct: draft('Северный ветер и Медная луна', 'Тестовая мелодия'), artistParts: [['Северный ветер'], ['Медная луна']] };
const solo = { ...baseQuestion, id: 'solo', number: 2, start: 10, fields: [{ key: 'artist', label: 'Исполнитель' }] };
const title = { ...baseQuestion, id: 'title', number: 3, start: 20, fields: [{ key: 'title', label: 'Песня' }] };
const chance = { ...baseQuestion, id: 'chance', number: 1, start: 40, close: 70, reveal: 71, fields: [{ key: 'artist', label: 'Исполнитель' }], chances: [{ start: 40, end: 50, points: 2 }, { start: 50, end: 60, points: 1 }, { start: 60, end: 70, points: .5 }] };
const fixture = { id: 'qa-episode', title: 'Synthetic test episode', revision: 'test-v1', mediaFile: 'fixture.mp4', duration: 80, rounds: [{ number: 1, title: 'Synthetic normal', start: 0, close: 30, reveal: 35, questions: [pair, solo, title] }, { number: 7, title: 'Synthetic chances', start: 40, close: 70, reveal: 71, questions: [chance] }] };
const fixturePath = join(temporary, 'server/video-data/prosto-v3.json');
const saveFixture = () => writeFileSync(fixturePath, JSON.stringify(fixture));
saveFixture(); writeFileSync(join(temporary, 'server/video-data/album-overrides.json'), '{}');
process.chdir(temporary);
const records = [];
let core, http, db;
async function test(name, action) {
 try { await action(); records.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
 catch (error) { records.push({ name, status: 'FAIL', message: error.message, stack: error.stack?.split('\n').slice(0, 6).join('\n') }); console.log('FAIL ' + name + ': ' + error.message); }
}
try {
 core = await import(pathToFileURL(join(root, 'server/video-quizzes.ts')).href);
 http = await import(pathToFileURL(join(root, 'server/video-http.ts')).href);
 const { questionMaximum } = await import(pathToFileURL(join(root, 'shared/video-quiz.ts')).href);
 db = core.videoDb();
 const guestA = core.createGuest('Guest A'), guestB = core.createGuest('Guest B');
 const share = core.shareFor(fixture.id);
 let epoch = 1000;
 const fresh = (player = guestA.id) => core.startVideoAttempt(player, fixture.id, true, epoch++);
 const sync = (a, at, drafts = {}, submit = undefined, player = guestA.id) => core.syncVideoAttempt(a.id, player, at, drafts, submit, 1000000);
 const row = (id, qid) => db.prepare('SELECT * FROM video_answers WHERE attempt_id=? AND question_id=?').get(id, qid);
 const api = (body, identity = guestA, extra = {}) => http.videoApi(new Request('https://quiz.test/g/video-api?share=' + share, { method: 'POST', headers: { host: 'quiz.test', origin: 'https://quiz.test', 'content-type': 'application/json', ...(identity ? { cookie: 'vq_guest=' + identity.secret } : {}), ...extra }, body: JSON.stringify(body) }), true);

 await test('fixture SQLite is isolated and legacy schema survives video initialization', () => {
  assert.equal(db.prepare('PRAGMA database_list').get().file, process.env.QUIZ_DB_PATH);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert(db.prepare("SELECT name FROM sqlite_schema WHERE name='attempts'").get());
 });
 await test('guest identity persists by hashed secret, not display name', () => {
  assert.equal(core.guestIdentity(guestA.secret).id, guestA.id);
  const sameName = core.createGuest('Guest A'); assert.notEqual(sameName.id, guestA.id);
  assert.equal(core.guestIdentity('x'), null);
  assert.notEqual(db.prepare('SELECT secret_hash FROM video_players WHERE id=?').get(guestA.id).secret_hash, guestA.secret);
 });
 await test('public episode excludes keys, aliases and editorial metadata', () => {
  const publicJson = JSON.stringify(core.publicEpisode(core.episodeById(fixture.id)));
  for (const field of ['correct', 'aliases', 'artistParts', 'album', 'mediaFile']) assert(!publicJson.includes('"' + field + '"'));
  assert(!publicJson.includes(pair.correct.artist));
 });
 await test('server derives half points, artist collaboration and single-field maxima', () => {
  assert.equal(core.scoreVideoAnswer(pair, draft('Северный ветер'), 30), .5);
  assert.equal(core.scoreVideoAnswer(pair, draft('', pair.correct.title), 30), .5);
  assert.equal(core.scoreVideoAnswer(pair, draft(pair.correct.artist, pair.correct.title), 30), 1.5);
  assert.equal(core.scoreVideoAnswer(solo, solo.correct, 30), 1);
  assert.equal(core.scoreVideoAnswer(title, title.correct, 30), 1);
  assert.equal(questionMaximum(pair), 1.5); assert.equal(questionMaximum(chance), 2);
 });
 await test('ordinary drafts auto-lock at close and remain invisible until reveal', () => {
  const a = fresh(); const before = sync(a, 29.99, { pair: pair.correct });
  assert.equal(before.answers.pair.locked, false);
  const closed = sync(a, 30); assert.equal(closed.answers.pair.locked, true); assert.equal(closed.answers.pair.submitted, true);
  for (const field of ['points', 'automaticPoints', 'correct', 'annulled']) assert(!(field in closed.answers.pair));
  assert.equal(closed.score, 0); assert.equal(closed.maxScore, 0);
  const shown = sync(a, 35); assert.equal(shown.answers.pair.points, 1.5); assert.equal(shown.score, 1.5);
 });
 await test('locked answer rejects late edits, backward progress and repeat requests', () => {
  const a = fresh(); sync(a, 30, { pair: pair.correct }); const saved = { ...row(a.id, 'pair') };
  sync(a, 29, { pair: draft('Wrong', 'Wrong') }); sync(a, 35, { pair: draft('Wrong', 'Wrong') });
  assert.deepEqual({ ...row(a.id, 'pair') }, saved); assert.equal(core.getVideoAttempt(a.id, guestA.id).position, 35);
 });
 await test('guest ownership guards read, sync and complaint before side effects', () => {
  const a = fresh(guestB.id); const snapshot = JSON.stringify(row(a.id, 'pair'));
  assert.throws(() => core.getVideoAttempt(a.id, guestA.id), e => e.status === 404);
  assert.throws(() => sync(a, 30, { pair: pair.correct }), e => e.status === 404);
  assert.throws(() => core.reportVideoQuestion(a.id, guestA.id, 'pair', 'Test report'), e => e.status === 404);
  assert.equal(JSON.stringify(row(a.id, 'pair')), snapshot);
  assert(!core.videoHistory(guestA.id).some(x => x.id === a.id));
 });
 await test('invalid or accelerated timeline requests fail atomically', () => {
  const a = core.startVideoAttempt(guestA.id, fixture.id, true, Date.now());
  for (const value of [-1, NaN, Infinity, 81]) assert.throws(() => core.syncVideoAttempt(a.id, guestA.id, value, {}));
  assert.throws(() => core.syncVideoAttempt(a.id, guestA.id, 35, {}), e => e.status === 409);
  assert.equal(core.getVideoAttempt(a.id, guestA.id).position, 0);
 });
 await test('R7 draft alone never earns points and expires unsubmitted', () => {
  const a = fresh(); sync(a, 45, { chance: chance.correct }); const result = sync(a, 71);
  assert.equal(result.answers.chance.points, 0); assert.equal(result.answers.chance.submitted, false); assert.equal(result.answers.chance.locked, true);
 });
 await test('R7 button earns2/1/0.5 only at the selected chance', () => {
  for (const [at, expected] of [[45, 2], [55, 1], [65, .5]]) {
   const a = fresh(); const hidden = sync(a, at, { chance: chance.correct }, 'chance');
   assert.equal(hidden.answers.chance.submitted, true); assert.equal(hidden.answers.chance.points, undefined);
   assert.equal(sync(a, 71).answers.chance.points, expected);
  }
 });
 await test('R7 one answer forever: wrong first submission cannot be replaced', () => {
  const a = fresh(); sync(a, 45, { chance: draft('Wrong') }, 'chance'); sync(a, 55, { chance: chance.correct }, 'chance');
  const shown = sync(a, 71); assert.equal(shown.answers.chance.points, 0); assert.equal(shown.answers.chance.draft.artist, 'Wrong'); assert.equal(shown.answers.chance.submittedAt, 45);
 });
 await test('R7 boundary accepts next weight at50, rejects70 and ordinary manual submit', () => {
  const a = fresh(); sync(a, 50, { chance: chance.correct }, 'chance'); assert.equal(sync(a, 71).answers.chance.points, 1);
  assert.throws(() => sync(fresh(), 70, { chance: chance.correct }, 'chance'), e => e.status === 409);
  assert.throws(() => sync(fresh(), 5, { pair: pair.correct }, 'pair'), e => e.status === 409);
 });
 await test('admin override is bounded, audited and preserves automatic answer', () => {
  const a = fresh(); sync(a, 35, { pair: pair.correct });
  for (const points of [-1, .25, 2, NaN]) assert.throws(() => core.correctVideoAnswer(a.id, 'pair', { points, reason: 'QA correction' }));
  assert.throws(() => core.correctVideoAnswer(a.id, 'pair', { points: .5, reason: '' }));
  const result = core.correctVideoAnswer(a.id, 'pair', { points: .5, reason: 'QA correction' });
  assert.equal(result.answers.pair.points, .5); assert.equal(result.answers.pair.automaticPoints, 1.5);
  assert.deepEqual(result.answers.pair.draft, pair.correct);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_audit WHERE attempt_id=?').get(a.id).n, 1);
 });
 await test('personal annulment and restore preserve override and denominator', () => {
  const a = fresh(); sync(a, 35, { pair: pair.correct }); core.correctVideoAnswer(a.id, 'pair', { points: .5, reason: 'QA' });
  const annulled = core.correctVideoAnswer(a.id, 'pair', { annulled: true, reason: 'QA' }); assert.equal(annulled.score, 0); assert.equal(annulled.maxScore, 2);
  const restored = core.correctVideoAnswer(a.id, 'pair', { annulled: false, reason: 'QA' }); assert.equal(restored.score, .5); assert.equal(restored.maxScore, 3.5);
 });
 await test('global annulment affects all players once and restores their own scores', () => {
  const a = fresh(), b = fresh(guestB.id); sync(a, 35, { pair: pair.correct }); sync(b, 35, { pair: draft('Северный ветер') }, undefined, guestB.id);
  core.correctVideoAnswer(a.id, 'pair', { global: true, annulled: true, reason: 'QA global' });
  assert.equal(core.getVideoAttempt(a.id, guestA.id).score, 0); assert.equal(core.getVideoAttempt(b.id, guestB.id).maxScore, 2);
  core.correctVideoAnswer(a.id, 'pair', { global: true, annulled: false, reason: 'QA restore' });
  assert.equal(core.getVideoAttempt(b.id, guestB.id).score, .5);
 });
 await test('complaint is private evidence and does not auto-award or annul', () => {
  const a = fresh(); sync(a, 35); const before = JSON.stringify(row(a.id, 'pair'));
  const report = core.reportVideoQuestion(a.id, guestA.id, 'pair', 'Please review points'); assert.equal(report.status, 'review');
  assert.equal(JSON.stringify(row(a.id, 'pair')), before);
  assert.throws(() => core.reportVideoQuestion(a.id, guestA.id, 'unknown', 'Please review'));
  assert.throws(() => core.reportVideoQuestion(a.id, guestA.id, 'chance', 'Please review'));
 });
 await test('guest HTTP forbids review/correct/share/resolveReport actions', async () => {
  const a = fresh(); sync(a, 35);
  for (const action of ['review', 'correct', 'share', 'resolveReport']) {
   const response = await api({ action, attemptId: a.id, questionId: 'pair', points: 1.5, reason: 'QA', quizId: fixture.id }); assert.equal(response.status, 403);
  }
 });
 await test('HTTP JSON errors and foreign Origin are rejected', async () => {
 const response = await api({ action: 'start', quizId: fixture.id }, guestA, { origin: 'https://other.test' }); assert.equal(response.status, 403);
  const malformed = await http.videoApi(new Request('https://quiz.test/g/video-api?share=' + share, { method: 'POST', headers: { host: 'quiz.test', 'content-type': 'application/json' }, body: '{' }), true); assert.equal(malformed.status, 400);
 });
 await test('HTTP null/array JSON must be client error rather than500', async () => {
  for (const body of [null, []]) { const response = await api(body); assert.equal(response.status, 400); }
 });
 await test('HTTP guest creation returns protected cookie and no secret in JSON', async () => {
  const response = await api({ action: 'start', quizId: fixture.id, name: 'Synthetic guest' }, null);
  assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie');
  for (const expected of ['HttpOnly', 'Secure', 'SameSite=lax']) assert(cookie.includes(expected));
  assert.equal((await response.json()).secret, undefined); assert.equal(response.headers.get('cache-control'), 'private, no-store');
 });
 await test('media Range/HEAD are exact and require matching guest share/session', async () => {
  const req = (range, cookie = true, method = 'GET') => new Request('https://quiz.test/g/video-media/' + fixture.id + '?share=' + share, { method, headers: { ...(range ? { range } : {}), ...(cookie ? { cookie: 'vq_guest=' + guestA.secret } : {}) } });
  const slice = http.videoMedia(req('bytes=2-5'), fixture.id, true); assert.equal(slice.status, 206); assert.equal(await slice.text(), '2345'); assert.equal(slice.headers.get('content-range'), 'bytes 2-5/16');
  const suffix = http.videoMedia(req('bytes=-4'), fixture.id, true); assert.equal(await suffix.text(), 'cdef');
  const head = http.videoMedia(req(undefined, true, 'HEAD'), fixture.id, true); assert.equal(head.headers.get('content-length'), '16'); assert.equal(await head.text(), '');
  assert.equal(http.videoMedia(req('bytes=99-'), fixture.id, true).status, 416); assert.equal(http.videoMedia(req(undefined, false), fixture.id, true).status, 403);
 });
 await test('fresh restart preserves old results, unfinished resume chooses same attempt', () => {
  const player = core.createGuest('Independent restart test').id;
  const a = fresh(player); sync(a, 80, { pair: pair.correct }, undefined, player); assert.equal(core.getVideoAttempt(a.id, player).completed, true);
  const b = core.startVideoAttempt(player, fixture.id, true, epoch++); assert.notEqual(a.id, b.id);
  assert.equal(core.startVideoAttempt(player, fixture.id, false).id, b.id);
  assert(core.videoHistory(player).some(h => h.id === a.id && h.completed));
 });
 await test('HTTP opening an old completed attempt returns that exact attempt, not a fresh one', async () => {
  const a = fresh(); sync(a, 80, { pair: pair.correct }); fresh();
  const response = await api({ action: 'open', attemptId: a.id }); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.attempt.id, a.id); assert.equal(body.attempt.completed, true); assert.equal(body.episode.revision, 'test-v1');
 });
 await test('HTTP ownership denial cannot leak attempts or create foreign reports', async () => {
  const a = fresh(guestB.id); const before = db.prepare('SELECT COUNT(*) AS n FROM video_reports').get().n;
  for (const action of ['open', 'sync', 'submit', 'report']) {
   const response = await api({ action, attemptId: a.id, questionId: 'pair', position: 35, comment: 'Review please' }); assert.equal(response.status, 404);
   const payload = await response.json(); assert.equal(payload.attempt, undefined);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_reports').get().n, before);
 });
 await test('repeating identical complaint is idempotent and never changes grade', () => {
  const a = fresh(); sync(a, 35, { pair: pair.correct });
  const first = core.reportVideoQuestion(a.id, guestA.id, 'pair', 'Проверьте громкость фрагмента');
  const again = core.reportVideoQuestion(a.id, guestA.id, 'pair', 'Проверьте громкость фрагмента');
  assert.equal(first.id, again.id); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_reports WHERE attempt_id=?').get(a.id).n, 1);
  assert.equal(core.getVideoAttempt(a.id, guestA.id).score, 1.5);
 });
 await test('SQLite reopen simulates process restart with guest identity and locked state preserved', () => {
  const a = fresh(); sync(a, 35, { pair: pair.correct }); db.close(); globalThis.musicQuizDatabase = undefined;
  db = core.videoDb(); assert.equal(core.guestIdentity(guestA.secret).id, guestA.id); const persisted = core.getVideoAttempt(a.id, guestA.id);
  assert.equal(persisted.answers.pair.locked, true); assert.equal(persisted.answers.pair.points, 1.5);
 });
 await test('historical statistics remain available after published revision changes', () => {
  const a = fresh(); sync(a, 80); fixture.revision = 'test-v2'; saveFixture();
  try { const history = core.videoHistory(guestA.id); assert(history.some(h => h.id === a.id)); }
  finally { fixture.revision = 'test-v1'; saveFixture(); }
 });
 await test('in-flight attempt retains old answer key and timings after new revision publication', () => {
  const a = fresh(); sync(a, 5, { pair: pair.correct });
  const next = JSON.parse(JSON.stringify(fixture)); next.revision = 'test-v2'; next.rounds[0].questions[0].correct = draft('Новый ансамбль', 'Другая мелодия'); next.rounds[0].questions[0].close = 60;
  writeFileSync(fixturePath, JSON.stringify(next));
  try { const old = sync(a, 35); assert.equal(old.answers.pair.points, 1.5); assert.deepEqual(old.answers.pair.correct, pair.correct); assert.equal(core.attemptEpisode(a.id, guestA.id).rounds[0].questions[0].close, 30); }
  finally { saveFixture(); }
 });
} finally {
 try { db?.close(); globalThis.musicQuizDatabase = undefined; } catch {}
 process.chdir(previousCwd);
 if (previousDb === undefined) delete process.env.QUIZ_DB_PATH; else process.env.QUIZ_DB_PATH = previousDb;
 if (previousMedia === undefined) delete process.env.VIDEO_QUIZ_MEDIA_DIR; else process.env.VIDEO_QUIZ_MEDIA_DIR = previousMedia;
 assert(temporary.startsWith(resolve(tmpdir()) + sep) && dirname(temporary) === resolve(tmpdir()));
 rmSync(temporary, { recursive: true, force: true });
}
const report = { status: records.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL', scope: 'Actual server/HTTP modules, synthetic episode, isolated temporary SQLite; no production database or video modified. Private admin HTTP route remains an Nginx deployment-boundary test.', count: records.length, passed: records.filter(r => r.status === 'PASS').length, tests: records };
const reportDir = join(root, 'work/video-site-qa'); mkdirSync(reportDir, { recursive: true }); writeFileSync(join(reportDir, 'server-integration-tests.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, count: report.count, passed: report.passed }));
if (report.status !== 'PASS') process.exitCode = 1;
