import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {isAccepted,isArtistAccepted} from '../app/scoring.ts';

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
function load(file){const {outputText}=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}});const m={exports:{}};new Function('require','module','exports',outputText)(name=>name==='server-only'||name.endsWith('.css')?{}:require(name),m,m.exports);return m.exports;}
const release=read('data/quiz-release-new-rules-12.json');
const records=read('data/quiz-release-new-rules-12-metadata.json');
const {getPersistedTrackInfo}=load('server/song-enrichment.ts');
const Card=load('app/track-reference-card.tsx').default;
const fingerprint=value=>String(value).normalize('NFKD').toLocaleLowerCase('ru-RU').replaceAll('ё','е').replace(/[^a-zа-я0-9]+/giu,'');

assert.equal(release.status,'verified');
assert.equal(release.quiz.id,'via-02');
assert.equal(release.quiz.level,'лёгкий');
assert.equal(release.tracks.length,20);
assert.deepEqual(release.stats.recognition,{recognizable:14,middle:6,deep:0});
assert.equal(new Set(release.tracks.map(t=>fingerprint(t.artist))).size,20);
assert.equal(new Set(release.tracks.map(t=>t.youtube.videoId)).size,20);
assert(!release.tracks.some(t=>['Синий иней','Люди встречаются'].includes(t.title)));

const history=[];
for(const name of fs.readdirSync(path.join(root,'data')).filter(n=>/^quiz-release-new-rules(?:-\d+)?\.json$/u.test(n)&&n!=='quiz-release-new-rules-12.json')){
 const doc=read('data/'+name);for(const track of doc.tracks||[])for(const alias of track.titleAliases||[track.title])history.push({name,value:fingerprint(alias)});
}
const extraSource=fs.readFileSync(path.join(root,'app/quiz-data-extra.ts'),'utf8');
for(const match of extraSource.matchAll(/extraTrack\([^\n]*?,\s*"[^"]+",\s*"([^"]+)"/gu))history.push({name:'quiz-data-extra.ts',value:fingerprint(match[1])});
for(const track of release.tracks)for(const alias of track.titleAliases)assert(!history.some(old=>old.value===fingerprint(alias)),`${track.artist} — ${alias} repeated in ${history.find(old=>old.value===fingerprint(alias))?.name}`);

let aliases=0;
for(const song of release.tracks){
 assert(song.readyForQuiz);assert.equal(song.clip.review,'verified');assert.equal(song.clip.requiresPublicationReview,false);
 assert(song.clip.duration>=8&&song.clip.duration<=16);
 assert.equal(song.optionalMetadata.artistForm,'Группа');assert.equal(song.optionalMetadata.audio.review,'verified');
 assert(Math.abs(Number(song.optionalMetadata.audio.normalizedMeasurement.input_i)+16)<=0.8);assert(Number(song.optionalMetadata.audio.normalizedMeasurement.input_tp)<=-1);
 const audioPath=path.join(root,'public',song.optionalMetadata.clipAudioUrl.replace(/^\//,''));assert(fs.existsSync(audioPath));
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex'),song.optionalMetadata.audio.normalizedSha256);
 for(const imageUrl of [song.optionalMetadata.album.coverUrl,song.optionalMetadata.artistImage.url])assert(fs.existsSync(path.join(root,'public',imageUrl.replace(/^\//,''))),imageUrl);
 assert.notEqual(song.optionalMetadata.album.coverUrl,song.optionalMetadata.artistImage.url);
 const info=getPersistedTrackInfo(song.artist,song.title,song.youtube.videoId);assert(info,song.songId);assert.equal(info.artistForm,'Группа',song.artist);assert(info.image?.url);assert(info.album?.coverUrl);assert(info.credits.length>=2);
 const html=renderToStaticMarkup(React.createElement(Card,{info:{...info,status:'ready'},track:{key:song.songId,artist:song.artist,title:song.title,artistForm:'Группа',versionYear:song.optionalMetadata.versionYear}}));assert(html.includes('Авторы'));assert(!html.includes('undefined'));assert((html.match(/<img/g)||[]).length>=2);
 for(const alias of song.titleAliases){assert(isAccepted(alias,song.titleAliases));aliases++;}
 for(const alias of song.artistAliases){assert(isArtistAccepted(alias,song.artistAliases,'Группа'));aliases++;}
 assert(records.songs[song.songId]);assert(records.catalogSongs.find(s=>s.id===song.songId));
}
const audioFiles=fs.readdirSync(path.join(root,'public/quiz-assets/via-02/audio')).filter(n=>n.endsWith('.mp3'));
assert.equal(audioFiles.length,20);
console.log(JSON.stringify({status:'PASS',quiz:release.quiz.id,cards:20,aliases,recognition:release.stats.recognition,historyCollisions:0,audioFiles:20}));
