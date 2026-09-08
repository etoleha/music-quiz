import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {isAccepted,isArtistAccepted} from '../app/scoring.ts';
const require=createRequire(import.meta.url), root=path.resolve(import.meta.dirname,'..');
function load(file){const {outputText}=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}});const m={exports:{}};new Function('require','module','exports',outputText)(name=>name==='server-only'||name.endsWith('.css')?{}:require(name),m,m.exports);return m.exports;}
const {getPersistedTrackInfo}=load('server/song-enrichment.ts');
const Card=load('app/track-reference-card.tsx').default;
const release=JSON.parse(fs.readFileSync(path.join(root,'data/quiz-release-new-rules-11.json'),'utf8'));
const records=JSON.parse(fs.readFileSync(path.join(root,'data/quiz-release-new-rules-11-metadata.json'),'utf8'));
assert.equal(release.tracks.length,20);assert.equal(new Set(release.tracks.map(t=>t.artist)).size,20);
assert.equal(new Set(release.tracks.map(t=>t.youtube.videoId)).size,20);
let aliases=0,unknownYears=0;
for(const song of release.tracks){
 assert.equal(song.optionalMetadata.artistForm,'Группа');
 const info=getPersistedTrackInfo(song.artist,song.title,song.youtube.videoId);
 assert(info,song.songId);assert.equal(info.artistForm,'Группа');
 assert(info.image?.url);assert(info.album?.coverUrl);assert.notEqual(info.image.url,info.album.coverUrl);
 assert(info.credits.length>=2);assert(info.credits.every(c=>Array.isArray(c.names)&&c.names.length));
 if(song.optionalMetadata.releaseYear===null){assert.equal(info.releaseYear,undefined);assert.equal(info.releaseYearStatus,'missing');unknownYears++;}
 else assert.equal(info.releaseYear,song.optionalMetadata.releaseYear);
 assert.equal(info.album.title,song.optionalMetadata.album.title);
 const html=renderToStaticMarkup(React.createElement(Card,{info:{...info,status:'ready'},track:{key:song.songId,artist:song.artist,title:song.title,artistForm:'Группа',versionYear:song.optionalMetadata.versionYear}}));
 assert(html.includes('Авторы'));assert(!html.includes('undefined'));assert((html.match(/<img/g)||[]).length>=2);
 for(const alias of song.titleAliases){assert(isAccepted(alias,song.titleAliases));aliases++;}
 for(const alias of song.artistAliases){assert(isArtistAccepted(alias,song.artistAliases,'Группа'));aliases++;}
 assert(!isAccepted('',song.titleAliases));assert(!isArtistAccepted('не знаю',song.artistAliases,'Группа'));
 assert(records.songs[song.songId]);assert(records.catalogSongs.find(s=>s.id===song.songId));
}
console.log(JSON.stringify({status:'PASS',cards:20,ensembles:20,aliases,unknownFirstYearsPreserved:unknownYears,playerDatabase:'not read or modified'}));
