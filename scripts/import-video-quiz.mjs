// Import the finished timeline; answer keys stay in a server-only JSON file.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'work/prosto-quiz-v3');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const timeline = JSON.parse(fs.readFileSync(path.join(root, 'timeline.json'), 'utf8'));
const forms = { group: 'Группа', male: 'Исполнитель', female: 'Исполнительница' };
const mixed = { r1q1: 'Группа + исполнительница', r2q5: 'Группа + исполнитель', r5q4: 'Группа + исполнительница', r5q9: 'Группа + группа' };
const parts = { r5q4: ['Винтаж', 'Елена Корикова'], r5q9: ['Дискотека Авария', 'Моральный кодекс'] };
const episode = { id: 'prosto-v3', title: 'Просто квиз · выпуск 3', revision: 'v3-2026-09-08', duration: timeline.expected_duration, mediaFile: 'prosto-v3.mp4', rounds: [] };
for (const r of manifest.rounds) {
  const scenes = timeline.segments.filter(s => s.round === r.number);
  const reveal = Math.min(...scenes.filter(s => s.kind === 'answer').map(s => s.start));
  const close = Math.max(...scenes.filter(s => s.kind === 'question').map(s => s.start + s.duration));
  const questions = r.questions.map((q, i) => {
    const qs = scenes.filter(s => s.kind === 'question' && s.song.id === q.id);
    const a = scenes.find(s => s.kind === 'answer' && s.song.id === q.id);
    const target = r.number === 7 ? 'artist' : q.target || 'both';
    const artistLabel = forms[q.artist_form] || mixed[q.id];
    if (!artistLabel) throw Error('Specify exact artist form: ' + q.id);
    const fields = target === 'both' ? [{ key: 'artist', label: artistLabel }, { key: 'title', label: 'Название песни' }] : [{ key: target === 'title' ? 'title' : 'artist', label: target === 'title' ? 'Название песни' : artistLabel }];
    return { id: q.id, number: i + 1, start: qs[0].start,
      close: r.number === 7 ? qs.at(-1).start + qs.at(-1).duration : close,
      reveal: r.number === 7 ? a.start : reveal, fields,
      chances: r.number === 7 ? qs.map((s, j) => ({ start: s.start, end: s.start + s.duration, points: [2, 1, .5][j] })) : [],
      correct: { artist: target === 'surname' || (r.number === 6 && target !== 'title') ? q.answer : q.artist, title: r.number === 6 && target === 'title' ? q.answer : q.title || '' },
      aliases: { artist: [q.artist, ...(q.accepted_artist_answers || [])], title: [q.title || q.answer || ''] },
      artistParts: q.artist_form === 'mixed' ? (q.performers || parts[q.id] || []).map(name => [name]) : [],
      year: r.number === 7 ? undefined : q.song_year || undefined,
      album: r.number === 7 ? undefined : q.album || undefined, coverArtist: q.cover_artist || undefined,
    };
  });
  episode.rounds.push({ number: r.number, title: r.title, start: scenes[0].start, close, reveal, questions });
}
fs.mkdirSync('server/video-data', { recursive: true });
fs.writeFileSync('server/video-data/prosto-v3.json', JSON.stringify(episode, null, 2) + '\n');
console.log('Imported 8 rounds / 80 questions. Private answer key saved.');
