import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

// Tests load the actual TS server modules, while fixtures and SQLite live only
// in an owned temporary directory. Published timelines are read only for pure
// navigation checks; production databases are never opened.
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
const baseQuestion = { start: 2, close: 30, reveal: 35, answerStart: 35, chances: [], aliases: { artist: [], title: [] }, artistParts: [], correct: draft('Северный ветер', 'Тестовая мелодия') };
const pair = { ...baseQuestion, id: 'pair', number: 1, fields: [{ key: 'artist', label: 'Исполнители' }, { key: 'title', label: 'Песня' }], correct: draft('Северный ветер и Медная луна', 'Тестовая мелодия'), artistParts: [['Северный ветер'], ['Медная луна']] };
const solo = { ...baseQuestion, id: 'solo', number: 2, start: 10, answerStart: 36, fields: [{ key: 'artist', label: 'Исполнитель' }] };
const title = { ...baseQuestion, id: 'title', number: 3, start: 20, answerStart: 38, fields: [{ key: 'title', label: 'Песня' }] };
const chance = { ...baseQuestion, id: 'chance', number: 1, start: 40, close: 70, reveal: 71, answerStart: 71, fields: [{ key: 'artist', label: 'Исполнитель' }], chances: [{ start: 40, end: 50, points: 2 }, { start: 50, end: 60, points: 1 }, { start: 60, end: 70, points: .5 }] };
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
 const { questionMaximum, nextAnswerAt } = await import(pathToFileURL(join(root, 'shared/video-quiz.ts')).href);
 db = core.videoDb();
 const guestA = core.createGuest('Guest A'), guestB = core.createGuest('Guest B');
 const share = core.shareFor(fixture.id);
 let epoch = 1000;
 const fresh = (player = guestA.id) => core.startVideoAttempt(player, fixture.id, true, epoch++);
 let playbackClock = 1000000;
 const sync = (a, at, drafts = {}, submit = undefined, player = guestA.id) => core.syncVideoAttempt(a.id, player, at, drafts, submit, playbackClock += 100000);
 const row = (id, qid) => db.prepare('SELECT * FROM video_answers WHERE attempt_id=? AND question_id=?').get(id, qid);
 const api = (body, identity = guestA, extra = {}) => http.videoApi(new Request('https://quiz.test/g/video-api?share=' + share, { method: 'POST', headers: { host: 'quiz.test', origin: 'https://quiz.test', 'content-type': 'application/json', ...(identity ? { cookie: 'vq_guest=' + identity.secret } : {}), ...extra }, body: JSON.stringify(body) }), true);

 await test('fixture SQLite is isolated and legacy schema survives video initialization', () => {
  assert.equal(db.prepare('PRAGMA database_list').get().file, process.env.QUIZ_DB_PATH);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert(db.prepare("SELECT name FROM sqlite_schema WHERE name='attempts'").get());
 });
 await test('next answer stays inside the playing round, including its final answer', () => {
  assert.equal(nextAnswerAt(fixture, 2), 35);
  assert.equal(nextAnswerAt(fixture, 35), 36);
  assert.equal(nextAnswerAt(fixture, 36), 38);
  assert.equal(nextAnswerAt(fixture, 38), undefined);
  assert.equal(nextAnswerAt(fixture, 39.99), undefined);
  assert.equal(nextAnswerAt(fixture, 40), 71);
  assert.equal(nextAnswerAt(fixture, 71), undefined);
  for (const version of [3, 4]) {
   const real = JSON.parse(readFileSync(join(root, `server/video-data/prosto-v${version}.json`), 'utf8'));
   for (const round of real.rounds) {
    const last = round.questions.at(-1).answerStart;
    assert.equal(nextAnswerAt(real, last), undefined, `${real.id} round ${round.number}`);
    assert.equal(nextAnswerAt(real, round.start), round.questions[0].answerStart);
   }
  }
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
 await test('personal artist accepts surname, transliteration and typo, including Plus1 and R7', () => {
  const singer = { ...solo, correct: draft('Григорий Лепс') };
  for (const value of ['Лепс', 'Leps', 'Григорий Лепс', 'Grigoriy Leps']) assert.equal(core.scoreVideoAnswer(singer, draft(value), 30), 1);
  const plusOne = { ...solo, id: 'r6q10', correct: draft('Денис Майданов') };
  for (const value of ['Майданов', 'Maydanov', 'Майдановв']) assert.equal(core.scoreVideoAnswer(plusOne, draft(value), 30), 1);
  assert.equal(core.scoreVideoAnswer({ ...chance, correct: draft('Григорий Лепс') }, draft('Лепс'), 45), 2);
  assert.equal(core.scoreVideoAnswer(singer, draft('Киркоров'), 30), 0);
 });
 await test('band names do not acquire personal surname aliases', () => {
  for (const [name, partial] of [['Агата Кристи', 'Кристи'], ['Братья Грим', 'Грим']]) {
   const group = { ...solo, fields: [{ key: 'artist', label: 'Группа' }], correct: draft(name) };
   assert.equal(core.scoreVideoAnswer(group, draft(partial), 30), 0);
   assert.equal(core.scoreVideoAnswer(group, draft(name), 30), 1);
  }
 });
 await test('title inflection typo counts as one Cyrillic edit and restores an old zero', () => {
  const song = { ...title, correct: draft('', 'Капли абсента') };
  assert.equal(core.scoreVideoAnswer(song, draft('', 'Капля абсента'), 30), 1);
  assert.equal(core.scoreVideoAnswer(song, draft('', 'Капля абсинта'), 30), 1);
  assert.equal(core.scoreVideoAnswer({ ...pair, correct: draft(pair.correct.artist, 'Капли абсента') }, draft('', 'Капля абсента'), 30), .5);
  const originalTitle = title.correct;
  try {
   title.correct = song.correct; saveFixture();
   const a = fresh(); sync(a, 35, { title: draft('', 'Капля абсента') });
   db.prepare('UPDATE video_answers SET automatic_points=0 WHERE attempt_id=? AND question_id=?').run(a.id, 'title');
   assert.equal(core.getVideoAttempt(a.id, guestA.id).answers.title.points, 1);
  } finally { title.correct = originalTitle; saveFixture(); }
 });
 await test('collaboration credits surname separately and both short artists in either order', () => {
  const mixed = { ...pair, fields: [{ key: 'artist', label: 'Группа + исполнитель' }, pair.fields[1]], correct: draft('Би-2 и Григорий Лепс', pair.correct.title), artistParts: [['Би-2'], ['Григорий Лепс']] };
  assert.equal(core.scoreVideoAnswer(mixed, draft('Лепс'), 30), .5);
  assert.equal(core.scoreVideoAnswer(mixed, draft('Би-2'), 30), .5);
  for (const value of ['Би-2 и Лепс', 'Leps + Bi-2', 'Лепс, Би-2']) assert.equal(core.scoreVideoAnswer(mixed, draft(value, pair.correct.title), 30), 1.5);
  assert.equal(core.scoreVideoAnswer(mixed, draft('Лепс и Лепс'), 30), .5);
 });
 await test('two short synthetic band names earn full artist credit across collaboration separators', () => {
  const shortBands = { ...pair, fields: [{ key: 'artist', label: 'Группа + группа' }, pair.fields[1]], correct: draft('Лад и Нота', pair.correct.title), artistParts: [['Лад'], ['Нота']] };
  for (const separator of [' и ', ' + ', ' feat. ', ' ft. ', ' & ', ', ', ' / ', ' x ', ' and ']) {
   assert.equal(core.scoreVideoAnswer(shortBands, draft(`Лад${separator}Нота`), 30), 1, separator);
   assert.equal(core.scoreVideoAnswer(shortBands, draft(`Нота${separator}Лад`, pair.correct.title), 30), 1.5, separator);
  }
  for (const value of ['Лад', 'Нота', 'Лад + Лад', 'Нота и Нота', 'Лад + Иной']) assert.equal(core.scoreVideoAnswer(shortBands, draft(value), 30), .5, value);
  assert.equal(core.scoreVideoAnswer(shortBands, draft('Иной + Чужой'), 30), 0);
 });
 await test('short synthetic band plus personal surname retains separate participant forms', () => {
  const mixed = { ...pair, fields: [{ key: 'artist', label: 'Группа + исполнитель' }, pair.fields[1]], correct: draft('Такт feat. Антон Липов', pair.correct.title), artistParts: [['Такт'], ['Антон Липов']] };
  for (const value of ['Такт и Липов', 'Такт + Липов', 'Такт feat. Антон Липов', 'Lipov & Takt', 'Липов, Такт']) assert.equal(core.scoreVideoAnswer(mixed, draft(value), 30), 1, value);
  for (const value of ['Липов', 'Такт', 'Липов и Липов']) assert.equal(core.scoreVideoAnswer(mixed, draft(value), 30), .5, value);
  assert.equal(core.scoreVideoAnswer(mixed, draft('Такт', pair.correct.title), 30), 1);
 });
 await test('two synthetic personal surnames receive full credit only when both participants are present', () => {
  const singers = { ...pair, fields: [{ key: 'artist', label: 'Исполнитель + исполнительница' }, pair.fields[1]], correct: draft('Антон Липов и Мария Кедрова', pair.correct.title), artistParts: [['Антон Липов'], ['Мария Кедрова']] };
  for (const value of ['Липов и Кедрова', 'Кедрова + Липов', 'Lipov feat. Kedrova']) assert.equal(core.scoreVideoAnswer(singers, draft(value), 30), 1, value);
  assert.equal(core.scoreVideoAnswer(singers, draft('Липов'), 30), .5);
  assert.equal(core.scoreVideoAnswer(singers, draft('Кедрова'), 30), .5);
  assert.equal(core.scoreVideoAnswer(singers, draft('Липов feat. Липов'), 30), .5);
 });
 await test('explicit jump freezes crossed ordinary drafts, reveals at canonical chapter and keeps R7 manual', () => {
  const a = fresh();
  const first = core.jumpVideoAttempt(a.id, guestA.id, 35, { pair: pair.correct }, 2000);
  assert.equal(first.position, 35); assert.equal(first.answers.pair.locked, true); assert.equal(first.answers.pair.points, 1.5);
  const end = core.jumpVideoAttempt(a.id, guestA.id, 80, { pair: draft('Wrong'), chance: chance.correct }, 2100);
  assert.equal(end.completed, true); assert.equal(end.answers.pair.points, 1.5);
  assert.equal(end.answers.chance.locked, true); assert.equal(end.answers.chance.submitted, false); assert.equal(end.answers.chance.points, 0);
 });
 await test('jump accepts chapter boundaries only and invalid targets leave attempt untouched', () => {
  for (const target of [0, 35, 40, 71, 80, 35.0005]) {
   const a = fresh(); const result = core.jumpVideoAttempt(a.id, guestA.id, target, {}, 2000);
   assert.equal(result.position, target === 35.0005 ? 35 : target);
  }
  const a = fresh(), before = JSON.stringify(core.getVideoAttempt(a.id, guestA.id));
  for (const target of [-1, NaN, Infinity, 81, 30, 45, 35.01]) assert.throws(() => core.jumpVideoAttempt(a.id, guestA.id, target, { pair: pair.correct }, 2000), e => e.status === 400);
  assert.equal(JSON.stringify(core.getVideoAttempt(a.id, guestA.id)), before);
 });
 await test('each answer has its own public navigation start, independent of round reveal', () => {
  const e = core.publicEpisode(core.episodeById(fixture.id));
  assert.deepEqual(e.rounds[0].questions.map(q => q.answerStart), [35, 36, 38]);
  assert.deepEqual(e.rounds[0].questions.map(q => q.reveal), [35, 35, 35]);
  const a = fresh();
  for (const target of [35, 36, 38]) assert.equal(core.jumpVideoAttempt(a.id, guestA.id, target, {}, 2000).position, target);
 });
 await test('next question saves ordinary draft but does not close the round form early', () => {
  const a = fresh();
  const next = core.jumpVideoAttempt(a.id, guestA.id, 10, { pair: draft('Черновик') }, 2000);
  assert.equal(next.answers.pair.locked, false); assert.equal(next.answers.pair.submitted, false); assert.equal(next.answers.pair.draft.artist, 'Черновик');
  const third = core.jumpVideoAttempt(a.id, guestA.id, 20, { pair: pair.correct }, 2001);
  assert.equal(third.answers.pair.locked, false); assert.deepEqual(third.answers.pair.draft, pair.correct);
  const closed = core.jumpVideoAttempt(a.id, guestA.id, 35, {}, 2002);
  assert.equal(closed.answers.pair.locked, true); assert.equal(closed.answers.pair.points, 1.5);
 });
 await test('R7 next musical fragment never submits a draft, and skipped question expires without score', () => {
  const a = fresh();
  for (const target of [40, 50, 60]) {
   const next = core.jumpVideoAttempt(a.id, guestA.id, target, { chance: chance.correct }, 2000);
   assert.equal(next.answers.chance.submitted, false); assert.equal(next.answers.chance.locked, false);
  }
  const answer = core.jumpVideoAttempt(a.id, guestA.id, 71, {}, 2001);
  assert.equal(answer.answers.chance.locked, true); assert.equal(answer.answers.chance.submitted, false); assert.equal(answer.answers.chance.points, 0);
 });
 await test('old snapshot receives navigation only, keeping its own keys, fields, scoring and stored JSON', () => {
  const old = JSON.parse(JSON.stringify(fixture)); old.revision = 'navigation-old';
  for (const r of old.rounds) for (const q of r.questions) delete q.answerStart;
  writeFileSync(fixturePath, JSON.stringify(old));
  let a;
  try {
   a = fresh();
   const before = db.prepare('SELECT payload_json FROM video_episode_versions WHERE quiz_id=? AND revision=?').get(old.id, old.revision).payload_json;
   const latest = JSON.parse(JSON.stringify(fixture)); latest.revision = old.revision;
   latest.rounds[0].questions[0].correct = draft('Другой исполнитель', 'Другая песня');
   latest.rounds[0].questions[0].fields = [{ key: 'title', label: 'Другие правила' }];
   latest.rounds[1].questions[0].chances[0].points = 9;
   writeFileSync(fixturePath, JSON.stringify(latest));
   const navigation = core.attemptEpisode(a.id, guestA.id);
   assert.deepEqual(navigation.rounds[0].questions.map(q => q.answerStart), [35, 36, 38]);
   assert.deepEqual(navigation.rounds[0].questions[0].fields, old.rounds[0].questions[0].fields);
   assert.equal(navigation.rounds[1].questions[0].chances[0].points, 2);
   const answer = core.jumpVideoAttempt(a.id, guestA.id, 36, { pair: pair.correct }, 2000);
   assert.deepEqual(answer.answers.pair.correct, pair.correct); assert.equal(answer.answers.pair.points, 1.5);
   assert.equal(db.prepare('SELECT payload_json FROM video_episode_versions WHERE quiz_id=? AND revision=?').get(old.id, old.revision).payload_json, before);
  } finally { saveFixture(); }
 });
 await test('navigation enrichment rejects changed identity, revision, duration or existing timing', () => {
  const old = JSON.parse(JSON.stringify(fixture)); old.revision = 'navigation-guard';
  for (const r of old.rounds) for (const q of r.questions) delete q.answerStart;
  writeFileSync(fixturePath, JSON.stringify(old));
  try {
   const a = fresh();
   const mutations = [e => { e.id = 'different'; }, e => { e.revision = 'different'; }, e => { e.duration += 1; }, ...['start', 'close', 'reveal'].map(key => e => { e.rounds[0][key] += 1; }), ...['start', 'close', 'reveal'].map(key => e => { e.rounds[0].questions[0][key] += 1; })];
   for (const mutate of mutations) {
    const changed = JSON.parse(JSON.stringify(fixture)); changed.revision = old.revision; mutate(changed);
    writeFileSync(fixturePath, JSON.stringify(changed));
    assert.equal(core.attemptEpisode(a.id, guestA.id).rounds[0].questions[1].answerStart, undefined);
   }
  } finally { saveFixture(); }
 });
 await test('jump honors ownership before any answer, position or scoring mutation', () => {
  const a = fresh(guestB.id), before = JSON.stringify(core.getVideoAttempt(a.id, guestB.id));
  assert.throws(() => core.jumpVideoAttempt(a.id, guestA.id, 80, { pair: pair.correct }, 2000), e => e.status === 404);
  assert.throws(() => core.jumpVideoAttempt(a.id, 'owner', 80, {}, 2000), e => e.status === 404);
  assert.equal(JSON.stringify(core.getVideoAttempt(a.id, guestB.id)), before);
 });
 await test('ordinary playback continues after jump using updated baseline, further implicit skip fails', () => {
  const a = core.startVideoAttempt(guestA.id, fixture.id, true, 1000);
  core.jumpVideoAttempt(a.id, guestA.id, 40, {}, 1100);
  assert.equal(core.syncVideoAttempt(a.id, guestA.id, 42, {}, undefined, 2100).position, 42);
  assert.throws(() => core.syncVideoAttempt(a.id, guestA.id, 71, {}, undefined, 2200), e => e.status === 409);
  assert.equal(core.getVideoAttempt(a.id, guestA.id).position, 42);
  assert.equal(core.syncVideoAttempt(a.id, guestA.id, 43, {}, undefined, 3100).position, 43);
 });
 await test('backward chapter jump never reopens answers, hides earned score or changes completion', () => {
  const a = fresh(); const end = core.jumpVideoAttempt(a.id, guestA.id, 80, { pair: pair.correct }, 2000);
  const back = core.jumpVideoAttempt(a.id, guestA.id, 0, { pair: draft('Wrong') }, 2100);
  assert.equal(back.position, 80); assert.equal(back.completed, true); assert.equal(back.score, end.score); assert.deepEqual(back.answers, end.answers);
 });
 await test('R7 button remains usable after jump, and a later jump preserves its original score', () => {
  const a = fresh(); core.jumpVideoAttempt(a.id, guestA.id, 40, { chance: chance.correct }, 2000);
  core.syncVideoAttempt(a.id, guestA.id, 40, { chance: draft('Северный ветер') }, 'chance', 2000);
  const end = core.jumpVideoAttempt(a.id, guestA.id, 80, { chance: draft('Wrong') }, 2001);
  assert.equal(end.answers.chance.points, 2); assert.equal(end.answers.chance.submittedAt, 40);
 });
 await test('jump validates the stored attempt revision rather than newly published chapter positions', () => {
  const a = fresh(); const next = JSON.parse(JSON.stringify(fixture)); next.revision = 'jump-v2'; next.rounds[1].start = 41;
  writeFileSync(fixturePath, JSON.stringify(next));
  try {
   assert.throws(() => core.jumpVideoAttempt(a.id, guestA.id, 41, {}, 2000), e => e.status === 400);
   assert.equal(core.jumpVideoAttempt(a.id, guestA.id, 40, {}, 2000).position, 40);
  } finally { saveFixture(); }
 });
 await test('accepted-answer shortcut requires explicit code plus points and writes a readable audit reason', () => {
  const a = fresh(); core.jumpVideoAttempt(a.id, guestA.id, 35, {}, 2000);
  const result = core.correctVideoAnswer(a.id, 'pair', { points: 1.5, reasonCode: 'accepted-answer' });
  assert.equal(result.answers.pair.points, 1.5); assert.equal(result.answers.pair.automaticPoints, 0);
  const audit = db.prepare('SELECT reason,after_json FROM video_audit WHERE attempt_id=?').get(a.id);
  assert.equal(audit.reason, 'Ответ принят ведущим'); assert.equal(JSON.parse(audit.after_json).reasonCode, 'accepted-answer');
  assert.equal(JSON.parse(audit.after_json).reason, audit.reason);
 });
 await test('accepted-answer cannot bypass annulment, global, numeric or reveal validation', () => {
  const a = fresh(); core.jumpVideoAttempt(a.id, guestA.id, 35, {}, 2000);
  for (const changes of [{ points: 1 }, { points: 1, reasonCode: 'other' }, { reasonCode: 'accepted-answer' }, { annulled: true, reasonCode: 'accepted-answer' }, { global: true, points: 1, reasonCode: 'accepted-answer' }, { annulled: false, points: 1, reasonCode: 'accepted-answer' }, { points: .25, reasonCode: 'accepted-answer' }, { points: NaN, reasonCode: 'accepted-answer' }, { points: 2, reasonCode: 'accepted-answer' }]) assert.throws(() => core.correctVideoAnswer(a.id, 'pair', changes));
  const hidden = fresh(); assert.throws(() => core.correctVideoAnswer(hidden.id, 'pair', { points: 1, reasonCode: 'accepted-answer' }), e => e.status === 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_audit WHERE attempt_id=?').get(a.id).n, 0);
 });
 await test('historical strict zero gains surname credit on read/history while preserving override and annulment', () => {
  const historical = JSON.parse(JSON.stringify(fixture)); historical.revision = 'historical-surname'; historical.rounds[0].questions[1].correct = draft('Денис Майданов');
  writeFileSync(fixturePath, JSON.stringify(historical));
  let a;
  try { a = fresh(); core.jumpVideoAttempt(a.id, guestA.id, 35, { solo: draft('Майданов') }, 2000); }
  finally { saveFixture(); }
  // Simulate the persisted result from the previously stricter scorer.
  db.prepare('UPDATE video_answers SET automatic_points=0 WHERE attempt_id=? AND question_id=?').run(a.id, 'solo');
  const read = core.getVideoAttempt(a.id, guestA.id);
  assert.equal(read.answers.solo.automaticPoints, 1); assert.equal(read.answers.solo.points, 1);
  assert.equal(core.videoHistory(guestA.id).find(h => h.id === a.id).score, 1);
  assert.equal(row(a.id, 'solo').automatic_points, 0); // Reading is not a destructive migration.
  const manual = core.correctVideoAnswer(a.id, 'solo', { points: .5, reason: 'Сохраняем ручной зачёт' });
  assert.equal(manual.answers.solo.automaticPoints, 1); assert.equal(manual.answers.solo.points, .5);
  const annulled = core.correctVideoAnswer(a.id, 'solo', { annulled: true, reason: 'Личная отмена' });
  assert.equal(annulled.answers.solo.automaticPoints, 1); assert.equal(annulled.answers.solo.points, 0);
  const restored = core.correctVideoAnswer(a.id, 'solo', { annulled: false, reason: 'Возвращаем' });
  assert.equal(restored.answers.solo.points, .5);
  core.correctVideoAnswer(a.id, 'solo', { global: true, annulled: true, reason: 'Общая отмена' });
  assert.equal(core.getVideoAttempt(a.id, guestA.id).answers.solo.points, 0);
  core.correctVideoAnswer(a.id, 'solo', { global: true, annulled: false, reason: 'Возвращаем общий' });
  assert.equal(core.getVideoAttempt(a.id, guestA.id).answers.solo.points, .5);
 });
 await test('historical reevaluation never lowers awarded score or awards an unsubmitted R7 draft', () => {
  const a = fresh(); core.jumpVideoAttempt(a.id, guestA.id, 80, { chance: chance.correct }, 2000);
  db.prepare('UPDATE video_answers SET automatic_points=1,artist=? WHERE attempt_id=? AND question_id=?').run('Другой ответ', a.id, 'solo');
  const read = core.getVideoAttempt(a.id, guestA.id);
  assert.equal(read.answers.solo.automaticPoints, 1); assert.equal(read.answers.solo.points, 1);
  assert.equal(read.answers.chance.automaticPoints, 0); assert.equal(read.answers.chance.points, 0); assert.equal(read.answers.chance.submitted, false);
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
   const response = await api({ action, attemptId: a.id, questionId: 'pair', points: 1.5, reasonCode: 'accepted-answer', quizId: fixture.id }); assert.equal(response.status, 403);
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
 await test('new episode keeps older attempts, keys, media and album overrides separate', async () => {
  const older = fresh(); sync(older, 35, { pair: pair.correct });
  const next = structuredClone(fixture); next.id = 'prosto-v4'; next.mediaFile = 'fixture-v4.mp4'; next.revision = 'four';
  next.rounds[0].questions[0].correct = draft('Другой дуэт', 'Новая песня'); next.rounds[0].questions[0].album = 'Свой альбом';
  const added = join(temporary, 'server/video-data/prosto-v4.json');
  writeFileSync(added, JSON.stringify(next)); writeFileSync(join(process.env.VIDEO_QUIZ_MEDIA_DIR, next.mediaFile), Buffer.from('new-video'));
  try {
   assert.deepEqual(core.episodes().map(e => e.id), ['prosto-v4', fixture.id]);
   assert.equal(core.episodeById('prosto-v4').rounds[0].questions[0].album, 'Свой альбом');
   const newer = core.startVideoAttempt(guestA.id, 'prosto-v4', true, epoch++);
   assert.notEqual(newer.id, older.id); assert.equal(newer.score, 0);
   assert.deepEqual(core.getVideoAttempt(older.id, guestA.id).answers.pair.correct, pair.correct);
   const response = http.videoMedia(new Request('https://quiz.test/media', { headers: { range: 'bytes=0-2' } }), 'prosto-v4', false);
   assert.equal(response.status, 206); assert.equal(await response.text(), 'new');
  } finally { rmSync(added); }
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
