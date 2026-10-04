import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const url = new URL('./vocal-remover.ts', import.meta.url).href;
registerHooks({resolve(specifier, context, next){
 if(context.parentURL===url){
  if(specifier==='./supabase')return {shortCircuit:true,url:'data:text/javascript,export const supabase={};'};
  if(specifier==='./wav-mix')return next(new URL('./wav-mix.ts',import.meta.url).href,context);
 }
 return next(specifier,context);
}});
const {decodeMediaAudioBuffer}=await import(url);
const nativeFetch=globalThis.fetch;
let closes=0;
globalThis.window={AudioContext:class {
 async decodeAudioData(){throw new DOMException('Unable to decode audio data','EncodingError')}
 createBuffer(channels,frames,rate){const values=Array.from({length:channels},()=>new Float32Array(frames));return {length:frames,duration:frames/rate,sampleRate:rate,numberOfChannels:channels,getChannelData:c=>values[c]}}
 async close(){closes++}
}};
function wav(){
 const bytes=new ArrayBuffer(48),v=new DataView(bytes);
 for(const [offset,tag] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<tag.length;i++)v.setUint8(offset+i,tag.charCodeAt(i));
 v.setUint32(4,40,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,44100,true);v.setUint32(28,88200,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,4,true);v.setInt16(44,16384,true);v.setInt16(46,-16384,true);return bytes;
}
afterEach(()=>{globalThis.fetch=nativeFetch;closes=0});
test('simultaneous final preload and play requests share a single media download',async()=>{
 let requests=0;globalThis.fetch=async()=>{requests++;return new Response(wav(),{headers:{'Content-Type':'audio/wav'}})};
 const [a,b]=await Promise.all([decodeMediaAudioBuffer('https://media.test/shared.wav'),decodeMediaAudioBuffer('https://media.test/shared.wav')]);
 assert.equal(requests,1);assert.equal(a,b);assert.equal(closes,1);assert.deepEqual(Array.from(a.getChannelData(0)),[0.5,-0.5]);
});
test('a CORS failure uses the proxy and decodes its actual audio bytes',async()=>{
 const requests=[];globalThis.fetch=async(input)=>{requests.push(input);if(input.startsWith('https:'))throw new TypeError('Failed to fetch');return new Response(wav(),{headers:{'Content-Type':'audio/wav'}})};
 assert.equal((await decodeMediaAudioBuffer('https://media.test/cors.wav')).length,2);
 assert.equal(requests.length,2);assert.match(requests[1],/^\/api\/video-proxy\?/);
});
test('HTML responses cannot masquerade as audio or generate a misleading decoder failure',async()=>{
 globalThis.fetch=async()=>new Response('<html>Error</html>',{headers:{'Content-Type':'text/html'}});
 await assert.rejects(decodeMediaAudioBuffer('https://media.test/html.wav'),/hata sayfası/);
 assert.equal(closes,0);
});
test('failed downloads retain HTTP status and release in-flight state for a retry',async()=>{
 globalThis.fetch=async()=>new Response('',{status:404});
 await assert.rejects(decodeMediaAudioBuffer('https://media.test/retry.wav'),/HTTP 404/);
 globalThis.fetch=async()=>new Response(wav(),{headers:{'Content-Type':'audio/wav'}});
 assert.equal((await decodeMediaAudioBuffer('https://media.test/retry.wav')).length,2);
});
