// Read-only deployment artifact check: curated files only; never open player SQLite.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
const artifact = path.resolve(process.argv[2] || '.');
const reference = process.argv[3] ? path.resolve(process.argv[3]) : null;
const read = (root, name) => fs.readFileSync(path.join(root, 'data', name));
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
const index = JSON.parse(read(artifact, 'song-database.json'));
const parts = index.archiveParts?.length ? index.archiveParts : [index.archive];
assert(parts.every((name, i) => /^song-database\.json\.gz(?:\.part-\d+)?$/.test(name) && (!index.archiveParts?.length || name === `song-database.json.gz.part-${String(i + 1).padStart(2, '0')}`)), 'Unsafe or noncontiguous archive parts');
const archive = Buffer.concat(parts.map(name => read(artifact, name)));
assert.equal(hash(archive), index.archiveSha256, 'Archive checksum mismatch');
assert.equal(hash(read(artifact, 'song-database.json.gz')), index.archiveSha256, 'Whole gzip and parts disagree');
const database = JSON.parse(zlib.gunzipSync(archive));
assert.equal(database.songs.length, index.stats.songs, 'Archive count mismatch');
const names = new Set(['song-database.json', 'song-database.json.gz', ...parts, 'song-enrichment-auto.json', 'song-enrichment-overrides.json', 'song-publication-verification.json', 'quiz-ready-songs.json', 'song-golden-reserve.json', 'quiz-candidates.json', 'quiz-generation-policy.json', 'artist-selection-policy.json', 'song-status-overrides.json', 'artist-aliases.json']);
for (const name of fs.readdirSync(path.join(reference || artifact, 'data'))) {
  if (/^(?:quiz-release-new-rules-\d+-metadata|song-pool[^/]*|chart[^/]*)\.json(?:\.gz)?$/.test(name)) names.add(name);
}
const files = [];
for (const name of [...names].sort()) {
  const raw = read(artifact, name);
  const item = { file: `data/${name}`, bytes: raw.length, sha256: hash(raw) };
  if (name.endsWith('.json')) {
    const data = JSON.parse(raw);
    item.counts = Object.fromEntries(['songs', 'artists', 'tracks'].filter(key => data[key] && typeof data[key] === 'object').map(key => [key, Object.keys(data[key]).length]));
  }
  if (reference) assert.equal(item.sha256, hash(read(reference, name)), `Artifact differs from source: ${name}`);
  files.push(item);
}
if (reference) {
  const directories = [artifact];
  while (directories.length) {
    const directory = directories.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert(!/\.(?:sqlite\d*|db)(?:[-.]|$)/i.test(entry.name), 'Player database must never be packaged');
      if (entry.isDirectory()) directories.push(path.join(directory, entry.name));
    }
  }
  for (const name of fs.readdirSync(path.join(reference, 'server', 'video-data')).filter(name => name.endsWith('.json'))) {
    const file = path.join('server', 'video-data', name);
    const raw = fs.readFileSync(path.join(artifact, file));
    assert.equal(hash(raw), hash(fs.readFileSync(path.join(reference, file))), `Artifact differs from source: ${file}`);
    files.push({ file: file.split(path.sep).join('/'), bytes: raw.length, sha256: hash(raw) });
  }
}
console.log(JSON.stringify({ status: 'PASS', root: artifact, songs: database.songs.length, files, database: 'not read or modified' }, null, 2));
