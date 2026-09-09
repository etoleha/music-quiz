// Import the finished timeline; answer keys stay in a server-only JSON file.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'work/prosto-quiz-v3');
const version = /^prosto-quiz-v(\d+)$/.exec(path.basename(root))?.[1];
if (!version) throw Error('Quiz directory must be named prosto-quiz-vN');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const timeline = JSON.parse(fs.readFileSync(path.join(root, 'timeline.json'), 'utf8'));
const youtubeId = value => {
  if (typeof value !== 'string') return undefined;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    const id = ['www.youtube.com', 'youtube.com'].includes(url.hostname) && url.pathname === '/watch' ? url.searchParams.get('v') : url.hostname === 'youtu.be' ? url.pathname.slice(1) : '';
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : undefined;
  } catch { return undefined; }
};
const sourceRecord = (key, filename = 'source.json') => {
  const file = path.join(root, 'media', key, filename);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
};
const videoLink = (label, source, fallback, start) => {
  const id = youtubeId(source?.id);
  if (!id) throw Error('Missing downloaded YouTube source for ' + label + ': ' + (fallback || 'unknown'));
  return { label, url: `https://www.youtube.com/watch?v=${id}${Number.isFinite(start) && start >= 0 ? `&t=${Math.floor(start)}s` : ''}` };
};
const answerLinks = (r, q) => {
  const separate = sourceRecord(q.id, 'answer-source.json');
  if (r.number === 7) {
    const links = q.songs.map((song, i) => {
      const source = sourceRecord(`${q.id}-s${i + 1}`);
      return videoLink(`Песня ${i + 1}`, source, song.youtube, source?.question_start ?? song.start);
    });
    const answer = videoLink('Видео ответа', separate || sourceRecord(`${q.id}-s3`), q.answer_youtube || q.songs.at(-1).youtube, q.answer_start ?? separate?.start ?? q.songs.at(-1).answer_start);
    if (!links.some(link => youtubeId(link.url) === youtubeId(answer.url))) links.push(answer);
    return links;
  }
  const links = [videoLink('Видео', separate || sourceRecord(q.id), q.answer_youtube || q.youtube, q.answer_start ?? separate?.start)];
  if (r.number === 4) links.push(videoLink('Кавер', sourceRecord(`${q.id}-cover`), q.cover_youtube || q.cover_source_id, q.cover_start));
  return links;
};
const chanceMusicEnd = scene => Number.isFinite(scene.music_duration) && scene.music_duration >= 0 && scene.music_duration <= scene.duration ? Number((scene.start + scene.music_duration).toFixed(4)) : undefined;
// Backfill only media links and music-end markers; preserve existing answer keys and timings.
if (process.argv.includes('--links-only')) {
  const file = `server/video-data/prosto-v${version}.json`;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (saved.id !== `prosto-v${version}`) throw Error('Episode identity mismatch');
  for (const r of saved.rounds) for (const q of r.questions) {
    const original = manifest.rounds.find(round => round.number === r.number)?.questions.find(candidate => candidate.id === q.id);
    if (!original) throw Error('Missing manifest question: ' + q.id);
    q.links = answerLinks(r, original);
    const scenes = timeline.segments.filter(s => s.kind === 'question' && s.round === r.number && s.song.id === q.id);
    for (const [i, chance] of q.chances.entries()) {
      const scene = scenes[i];
      if (!scene || Math.abs(chance.start - scene.start) > .0001 || Math.abs(chance.end - scene.start - scene.duration) > .0001) throw Error('Chance timeline mismatch: ' + q.id);
      const end = chanceMusicEnd(scene);
      if (end !== undefined) chance.musicEnd = end;
    }
  }
  fs.writeFileSync(file, JSON.stringify(saved, null, 2) + '\n');
  console.log(`Backfilled links and musicEnd only: ${saved.id}`);
  process.exit(0);
}
const forms = { group: 'Группа', male: 'Исполнитель', female: 'Исполнительница', mixed: 'Исполнители', duet: 'Исполнители' };
// Remove pronunciation stress while preserving the breve in й and diaeresis in ё.
const readable = value => typeof value === 'string' ? value.normalize('NFD').replace(/\u0301/g, '').normalize('NFC').trim() : '';
const aliases = values => [...new Set(values.map(readable).filter(Boolean))];
const mixed = { r1q1: 'Группа + исполнительница', r2q5: 'Группа + исполнитель', r5q4: 'Группа + исполнительница', r5q9: 'Группа + группа' };
const parts = { r5q4: ['Винтаж', 'Елена Корикова'], r5q9: ['Дискотека Авария', 'Моральный кодекс'] };
const releaseDate = process.env.VIDEO_QUIZ_RELEASE_DATE || new Date().toISOString().slice(0, 10);
const episode = { id: `prosto-v${version}`, title: `Просто квиз · выпуск ${version}`, revision: `v${version}-${releaseDate}`, duration: timeline.expected_duration, mediaFile: `prosto-v${version}.mp4`, rounds: [] };
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
      chances: r.number === 7 ? qs.map((s, j) => ({ start: s.start, end: s.start + s.duration, musicEnd: chanceMusicEnd(s), points: [2, 1, .5][j] })) : [],
      links: answerLinks(r, q),
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
