import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const output=ts.transpileModule(fs.readFileSync('app/clip-audio-player.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={exports:{}};new Function('exports','module',output)(mod.exports,mod);
const {createClipAudioPlayer}=mod.exports;
class FakeAudio {
  currentTime=0;volume=0;src='';onplaying=null;onended=null;onerror=null;paused=true;error=null;
  play(){this.paused=false;return this.reject ? Promise.reject(this.reject) : Promise.resolve();}
  pause(){this.paused=true;}
  removeAttribute(){this.src='';}
  load(){}
}
const elements=[];const calls=[];const factory=()=>{const a=new FakeAudio();elements.push(a);return a;};
const events={playing:()=>calls.push('playing'),ended:()=>calls.push('ended'),error:code=>calls.push('error:'+code),blocked:()=>calls.push('blocked')};
const p=createClipAudioPlayer('/clip-a.mp3',47,events,factory);
p.loadVideoById({videoId:'original-youtube-id',startSeconds:47});
assert.equal(elements[0].src,'/clip-a.mp3');assert.equal(elements[0].currentTime,0);assert.equal(elements[0].volume,1);
p.setVolume(35);assert.equal(elements[0].volume,1,'old iframe gain cannot undo normalization');
elements[0].onplaying();elements[0].currentTime=6.25;assert.equal(p.getCurrentTime()-47,6.25,'quiz timer measures clip progress from the original offset');
const delayedFirstPlaying=elements[0].onplaying;
p.pauseVideo();assert.equal(elements[0].paused,true);assert.equal(p.getCurrentTime(),53.25);
delayedFirstPlaying();assert.deepEqual(calls,['playing'],'queued event after pause cannot restart quiz clock');
p.loadVideoById({videoId:'original',startSeconds:53.25});assert.equal(elements[1].currentTime,6.25,'navigation resume retains consumed seconds');
elements[1].onplaying();elements[1].currentTime=15;elements[1].onended();assert.equal(p.getCurrentTime(),62);assert.equal(calls.at(-1),'ended','short native file ends clock without waiting for RAF');
p.loadVideoById({videoId:'original',startSeconds:47});assert.equal(elements[2].currentTime,0,'second listening restarts full excerpt');
const delayedOldEnd=elements[2].onended;
p.stopVideo();assert.equal(elements[2].paused,true);assert.equal(elements[2].src,'');const before=calls.length;delayedOldEnd();assert.equal(calls.length,before,'skip invalidates old end event');
const q=createClipAudioPlayer('/clip-b.mp3',103,events,factory);q.loadVideoById({videoId:'other-original',startSeconds:103});assert.equal(elements[3].src,'/clip-b.mp3');assert.equal(q.getCurrentTime(),103);delayedOldEnd();assert.equal(calls.length,before,'old question cannot complete the new question');q.dispose();
const blocked=createClipAudioPlayer('/blocked.mp3',0,events,()=>{const a=new FakeAudio();a.reject=new DOMException('gesture required','NotAllowedError');return a;});blocked.loadVideoById({videoId:'',startSeconds:0});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.at(-1),'blocked','autoplay denial is recoverable, not a broken fragment');
const canceled=createClipAudioPlayer('/slow.mp3',0,events,()=>{const a=new FakeAudio();a.reject=new DOMException('gesture required','NotAllowedError');return a;});canceled.loadVideoById({videoId:'',startSeconds:0});canceled.dispose();const count=calls.length;await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,count,'late rejected play promise after skip cannot refund the next question');
console.log('PASS clip audio: original-time clock, pause/resume, repeat, native end, skip/change, normalized gain, autoplay and stale promises');
// Exercise the actual MusicQuiz playback callbacks in isolation: no browser UI,
// network, persistence, React rendering or user progress is touched.
let componentSource=fs.readFileSync('app/music-quiz.tsx','utf8');
componentSource=componentSource.replace('useState<Track[]>([])','useState<Track[]>([globalThis.__testTrack])').replace('const [playerReady, setPlayerReady] = useState(false)','const [playerReady, setPlayerReady] = useState(true)');
componentSource=componentSource.replace('  const leaveResults = useCallback',`  globalThis.__testPlayback = {playClip, playReviewClip, triesRef, playingRef, player, youtubePlayer, resumeClipAt, activeClip, stopClipClock}; return null;
  const leaveResults = useCallback`);
const code=ts.transpileModule(componentSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const react={useState:v=>[typeof v==='function'?v():v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{},useMemo:f=>f(),useCallback:f=>f};
const componentMod={exports:{}};new Function('require','exports','module',code)(name=>name==='react'?react:name==='./clip-audio-player'?mod.exports:{},componentMod.exports,componentMod);
let raf=[];globalThis.requestAnimationFrame=cb=>{raf.push(cb);return raf.length;};globalThis.cancelAnimationFrame=()=>{};
const actualAudio=[];globalThis.Audio=class extends FakeAudio {constructor(){super();actualAudio.push(this);}};
globalThis.__testTrack={key:'local-question',youtubeId:'keep-source',clipAudioUrl:'/normalized.mp3',start:80,duration:15};
componentMod.exports.default();let c=globalThis.__testPlayback;
c.playClip();assert.equal(c.triesRef.current,1);assert.equal(actualAudio.at(-1).currentTime,0);c.playClip();assert.equal(c.triesRef.current,1,'double click during playback does not spend extra listening');
actualAudio.at(-1).onplaying();actualAudio.at(-1).currentTime=15;raf.shift()();assert.equal(c.playingRef.current,false,'actual RAF clock stops at clip duration');assert.equal(actualAudio.at(-1).paused,true);
c.playClip();assert.equal(c.triesRef.current,0);assert.equal(actualAudio.at(-1).currentTime,0);actualAudio.at(-1).onended();assert.equal(c.activeClip.current,null);c.playClip();assert.equal(c.triesRef.current,0);assert.equal(actualAudio.length,2,'third playback refused');
c.resumeClipAt.current=86;c.playClip();assert.equal(c.triesRef.current,0,'resume does not consume another listening');assert.equal(actualAudio.at(-1).currentTime,6);c.player.current.stopVideo();c.stopClipClock();c.playingRef.current=false;
c.playReviewClip(globalThis.__testTrack);assert.equal(actualAudio.at(-1).currentTime,0);assert.equal(c.triesRef.current,0,'review playback does not alter attempts');c.player.current.stopVideo();
globalThis.__testTrack={key:'legacy-question',youtubeId:'legacy-id',start:42,duration:12,playbackVolume:57};componentMod.exports.default();c=globalThis.__testPlayback;const ytCalls=[];const yt={stopVideo:()=>ytCalls.push('stop'),setVolume:v=>ytCalls.push(['volume',v]),loadVideoById:v=>ytCalls.push(['load',v]),pauseVideo:()=>{},getCurrentTime:()=>42};c.youtubePlayer.current=yt;c.playClip();assert.equal(c.player.current,yt);assert.deepEqual(ytCalls,[['volume',57],['load',{videoId:'legacy-id',startSeconds:42}]]);assert.equal(c.triesRef.current,1,'legacy YouTube retains two-listening accounting');
console.log('PASS actual MusicQuiz callbacks: 2 listens, double click, timer boundary, third-play guard, resume without extra try, review, unchanged YouTube load/volume contract');
const blockedAudio=[];globalThis.Audio=class extends FakeAudio {constructor(){super();this.reject=new DOMException('gesture required','NotAllowedError');blockedAudio.push(this);}};
globalThis.__testTrack={key:'blocked-local',youtubeId:'source-id',clipAudioUrl:'/normalized.mp3',start:55,duration:15};componentMod.exports.default();c=globalThis.__testPlayback;c.playClip();await new Promise(resolve=>setImmediate(resolve));assert.equal(c.triesRef.current,2,'actual blocked autoplay refunds listening');assert.equal(c.playingRef.current,false);
c.triesRef.current=0;c.resumeClipAt.current=61;c.playClip();await new Promise(resolve=>setImmediate(resolve));assert.equal(c.triesRef.current,0);assert.equal(c.resumeClipAt.current,61,'blocked resume preserves position and does not refund unspent try');
console.log('PASS actual callbacks: blocked autoplay refund and blocked resume restore');
