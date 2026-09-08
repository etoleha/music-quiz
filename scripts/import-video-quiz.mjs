// Import the finished timeline; answer keys stay in a server-only JSON file.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'work/prosto-quiz-v3');
const version = /^prosto-quiz-v(\d+)$/.exec(path.basename(root))?.[1];
if (!version) throw Error('Quiz directory must be named prosto-quiz-vN');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const timeline = JSON.parse(fs.readFileSync(path.join(root, 'timeline.json'), 'utf8'));
const forms = { group: 'Группа', male: 'Исполнитель', female: 'Исполнительница' };
// Remove pronunciation stress while preserving the breve in й and diaeresis in ё.
const readable = value => typeof value === 'string' ? value.normalize('NFD').replace(/\u0301/g, '').normalize('NFC').trim() : '';
const aliases = values => [...new Set(values.map(readable).filter(Boolean))];
const mixed = { r1q1: 'Группа + исполнительница', r2q5: 'Группа + исполнитель', r5q4: 'Группа + исполнительница', r5q9: 'Группа + группа' };
const parts = { r5q4: ['Винтаж', 'Елена Корикова'], r5q9: ['Дискотека Авария', 'Моральный кодекс'] };
const episode = { id: `prosto-v${version}`, title: `Просто квиз · выпуск ${version}`, revision: `v${version}-2026-09-08`, duration: timeline.expected_duration, mediaFile: `prosto-v${version}.mp4`, rounds: [] };
for (const r of manifest.rounds) {
  const scenes = timeline.segments.filter(s => s.round === r.number);
  const reveal = Math.min(...scenes.filter(s => s.kind === 'answer').map(s => s.start));
  const close = Math.max(...scenes.filter(s => s.kind === 'question' || s.kind === 'writing').map(s => s.start + s.duration));
  const questions = r.questions.map((q, i) => {
    const qs = scenes.filter(s => s.kind === 'question' && s.song.id === q.id);
    const a = scenes.find(s => s.kind === 'answer' && s.song.id === q.id);
    const target = r.number === 7 ? 'artist' : q.target || 'both';
    const artistLabel = q.artist_prompt || forms[q.artist_form] || (version === '3' ? mixed[q.id] : undefined);
    if (!artistLabel) throw Error('Specify exact artist form: ' + q.id);
    const fields = target === 'both' ? [{ key: 'artist', label: artistLabel }, { key: 'title', label: 'Название песни' }] : [{ key: target === 'title' ? 'title' : 'artist', label: target === 'title' ? 'Название песни' : artistLabel }];
    return { id: q.id, number: i + 1, start: qs[0].start,
      close: r.number === 7 ? qs.at(-1).start + qs.at(-1).duration : close,
      reveal: r.number === 7 ? a.start : reveal, answerStart: a.start, fields,
      chances: r.number === 7 ? qs.map((s, j) => ({ start: s.start, end: s.start + s.duration, points: [2, 1, .5][j] })) : [],
      correct: { artist: target === 'surname' || (r.number === 6 && target !== 'title') ? q.answer : q.artist, title: r.number === 6 && target === 'title' ? q.answer : q.title || '' },
      aliases: { artist: aliases([q.artist, q.spoken_artist, ...(q.accepted_artist_answers || [])]), title: aliases([q.title || q.answer || '', q.spoken_title, ...(q.accepted_title_answers || [])]) },
      artistParts: ['mixed', 'duet'].includes(q.artist_form) ? (q.performers || (version === '3' ? parts[q.id] : []) || []).map(name => [name]) : [],
      year: r.number === 7 ? undefined : q.song_year || undefined,
      album: r.number === 7 ? undefined : q.album || undefined, coverArtist: q.cover_artist || undefined,
    };
  });
  episode.rounds.push({ number: r.number, title: r.title, start: scenes[0].start, close, reveal, questions });
}
fs.mkdirSync('server/video-data', { recursive: true });
fs.writeFileSync(`server/video-data/prosto-v${version}.json`, JSON.stringify(episode, null, 2) + '\n');
console.log('Imported 8 rounds / 80 questions. Private answer key saved.');
