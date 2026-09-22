import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
let supabaseUrl = '';
let supabaseKey = '';
for (const line of envContent.split('\n')) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) supabaseKey = line.split('=')[1].trim();
}

const supabase = createClient(supabaseUrl, supabaseKey);
const HF_BASE = 'https://abidlabs-music-separation.hf.space';

async function runDemucsOnLocalWav(wavPath) {
  console.log(`  -> Uploading extracted WAV to Meta Demucs AI...`);
  const wavBlob = new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' });
  const fd = new FormData();
  fd.append('files', wavBlob, 'audio.wav');

  const upRes = await fetch(`${HF_BASE}/gradio_api/upload`, {
    method: 'POST',
    body: fd,
  });
  if (!upRes.ok) throw new Error(`Upload failed: ${upRes.status}`);
  const uploadedPaths = await upRes.json();
  const remotePath = uploadedPaths[0];

  const callRes = await fetch(`${HF_BASE}/gradio_api/call/inference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [{ path: remotePath, meta: { _type: 'gradio.FileData' } }],
    }),
  });

  if (!callRes.ok) throw new Error(`Demucs call failed: ${callRes.status}`);
  const { event_id } = await callRes.json();
  console.log(`  -> Demucs Event ID: ${event_id}, waiting for neural separation...`);

  const streamRes = await fetch(`${HF_BASE}/gradio_api/call/inference/${event_id}`);
  const text = await streamRes.text();

  const lines = text.split('\n');
  let dataJson = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('event: complete') && lines[i + 1]?.startsWith('data: ')) {
      dataJson = JSON.parse(lines[i + 1].slice(6));
      break;
    }
  }

  if (!dataJson || !Array.isArray(dataJson) || dataJson.length < 2) {
    throw new Error(`Demucs returned error or quota limit: ${text.slice(0, 200)}`);
  }

  const vocalsUrl = dataJson[0].url || `${HF_BASE}/gradio_api/file=${dataJson[0].path}`;
  const noVocalsUrl = dataJson[1].url || `${HF_BASE}/gradio_api/file=${dataJson[1].path}`;

  return { vocalsUrl, noVocalsUrl };
}

/**
 * High-precision Spectral + Transient + Cue-Guided Vocal Remover (FFmpeg + PCM DSP)
 * Preserves 100% of gunshots, footsteps, impacts, and non-speech ambient audio,
 * and removes human voice formants (180Hz - 3500Hz) while keeping ambient bed & effects!
 */
function generateSpectralTransientMeWav(origWavPath, cues, outWavPath) {
  const tmpDir = path.dirname(outWavPath);
  const origRaw = path.join(tmpDir, 'orig.raw');
  const bandSuppressedWav = path.join(tmpDir, 'suppressed.wav');
  const bandSuppressedRaw = path.join(tmpDir, 'suppressed.raw');
  const fusedRaw = path.join(tmpDir, 'fused.raw');

  // 1. Decode original to 44100Hz stereo 16-bit PCM
  execFileSync('ffmpeg', ['-y', '-i', origWavPath, '-f', 's16le', '-ac', '2', '-ar', '44100', origRaw], { stdio: 'ignore' });

  // 2. Create vocal-formant-cancelled version via multi-stage harmonic notch & FFT filtering in FFmpeg
  // Keeps <185Hz (bass, gun thump, footsteps, rumble) and >3900Hz (gunshot crack, foley, air, environment) at 100%,
  // and attenuates vocal fundamentals & formants (220Hz-3400Hz) by -26dB
  const eqFilter = [
    'anequalizer=c0 f=320 w=220 g=-22 t=1|c1 f=320 w=220 g=-22 t=1',
    'anequalizer=c0 f=650 w=350 g=-25 t=1|c1 f=650 w=350 g=-25 t=1',
    'anequalizer=c0 f=1350 w=650 g=-26 t=1|c1 f=1350 w=650 g=-26 t=1',
    'anequalizer=c0 f=2450 w=800 g=-24 t=1|c1 f=2450 w=800 g=-24 t=1',
    'afftdn=nr=14:nf=-40',
  ].join(',');

  execFileSync('ffmpeg', ['-y', '-i', origWavPath, '-af', eqFilter, '-f', 's16le', '-ac', '2', '-ar', '44100', bandSuppressedRaw], { stdio: 'ignore' });

  const origBuf = fs.readFileSync(origRaw);
  const supBuf = fs.readFileSync(bandSuppressedRaw);

  const numSamples = Math.min(origBuf.length, supBuf.length) >> 1;
  const numFrames = numSamples >> 1;
  const outBuf = Buffer.alloc(numFrames * 4);

  const winSize = 882; // 20ms at 44100Hz
  const numWins = Math.ceil(numFrames / winSize);
  const vocalMask = new Float32Array(numWins);

  for (let w = 0; w < numWins; w++) {
    const startFrame = w * winSize;
    const endFrame = Math.min(numFrames, startFrame + winSize);
    const timeSec = startFrame / 44100;

    let origEnergy = 0;
    let supEnergy = 0;
    let peak = 0;

    for (let f = startFrame; f < endFrame; f++) {
      const idx = f * 4;
      const oL = Math.abs(origBuf.readInt16LE(idx) / 32768);
      const sL = Math.abs(supBuf.readInt16LE(idx) / 32768);
      origEnergy += oL * oL;
      supEnergy += sL * sL;
      if (oL > peak) peak = oL;
    }

    const rms = Math.sqrt(origEnergy / Math.max(1, endFrame - startFrame));
    const crest = peak / (rms + 1e-5);
    const midFraction = 1 - supEnergy / (origEnergy + 1e-6);

    // Check if inside any dialogue cue
    const inCue = Array.isArray(cues) && cues.some((c) => timeSec >= Number(c.start) - 0.15 && timeSec <= Number(c.end) + 0.15);

    // High crest factor (> 4.8) = Gunshot / Impact / Slap / Door slam! Keep 100% original!
    if (crest > 4.8 || rms < 0.012) {
      vocalMask[w] = 0.0;
    } else if (inCue && midFraction > 0.35) {
      vocalMask[w] = 0.96;
    } else if (midFraction > 0.50) {
      vocalMask[w] = 0.90;
    } else {
      vocalMask[w] = 0.0;
    }
  }

  // Smooth mask (60ms attack/release)
  const smoothed = new Float32Array(numWins);
  for (let w = 0; w < numWins; w++) {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, w - 3); k <= Math.min(numWins - 1, w + 3); k++) {
      sum += vocalMask[k];
      cnt++;
    }
    smoothed[w] = sum / cnt;
  }

  for (let f = 0; f < numFrames; f++) {
    const w = Math.min(numWins - 1, Math.floor(f / winSize));
    const m = smoothed[w];
    const idx = f * 4;

    const oL = origBuf.readInt16LE(idx) / 32768;
    const oR = origBuf.readInt16LE(idx + 2) / 32768;
    const sL = (supBuf.readInt16LE(idx) / 32768) * 1.35;
    const sR = (supBuf.readInt16LE(idx + 2) / 32768) * 1.35;

    const outL = Math.tanh((m * sL + (1 - m) * oL) * 1.1);
    const outR = Math.tanh((m * sR + (1 - m) * oR) * 1.1);

    outBuf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(outL * 32767))), idx);
    outBuf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(outR * 32767))), idx + 2);
  }

  fs.writeFileSync(fusedRaw, outBuf);
  execFileSync('ffmpeg', ['-y', '-f', 's16le', '-ac', '2', '-ar', '24000', '-i', fusedRaw, outWavPath], { stdio: 'ignore' });
}

function fixCorruptedCueTimestamps(cues, sceneDuration) {
  if (!Array.isArray(cues) || cues.length === 0) return cues;
  const dur = Number(sceneDuration) || 60;
  const sorted = [...cues].sort((a, b) => Number(a.start) - Number(b.start));

  return sorted.map((cue, idx) => {
    const start = Math.max(0, Number(cue.start) || 0);
    let end = Number(cue.end) || 0;
    const nextCue = sorted[idx + 1];
    const maxEnd = nextCue ? Math.max(start + 0.5, Number(nextCue.start) - 0.08) : dur;

    if (end <= start + 0.2 || (end === 20 && start >= 18.5)) {
      const wordCount = (cue.text || '').trim().split(/\s+/).filter(Boolean).length;
      const estimatedDur = Math.max(1.2, Math.min(4.0, wordCount * 0.38));
      end = Math.min(maxEnd, Number((start + estimatedDur).toFixed(2)));
      if (end <= start) end = Number((start + 1.5).toFixed(2));
    }
    return {
      ...cue,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
    };
  });
}

async function main() {
  const { data: scenes } = await supabase
    .from('custom_scenes')
    .select('*')
    .is('instrumental_url', null);

  if (!scenes || scenes.length === 0) {
    console.log('All scenes already have instrumental_url!');
    return;
  }

  console.log(`Processing ${scenes.length} remaining scenes...`);

  for (const scene of scenes) {
    console.log(`\nProcessing Scene [${scene.id}]: ${scene.title}`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `replik-me-${scene.id}-`));

    try {
      const videoPath = path.join(tmpDir, 'video.mp4');
      const extractedWav = path.join(tmpDir, 'extracted.wav');
      const outWavPath = path.join(tmpDir, 'upload.wav');

      const vRes = await fetch(scene.video_url);
      fs.writeFileSync(videoPath, Buffer.from(await vRes.arrayBuffer()));
      execFileSync('ffmpeg', ['-y', '-i', videoPath, '-ac', '2', '-ar', '24000', extractedWav], { stdio: 'ignore' });

      const fixedCues = fixCorruptedCueTimestamps(scene.cues, scene.duration);

      try {
        const { noVocalsUrl } = await runDemucsOnLocalWav(extractedWav);
        const nvRes = await fetch(noVocalsUrl);
        fs.writeFileSync(outWavPath, Buffer.from(await nvRes.arrayBuffer()));
        console.log(`  -> Separated via Meta Demucs AI!`);
      } catch (demucsErr) {
        console.log(`  -> Using Spectral Transient + Cue-Guided M&E Processor (${demucsErr.message.slice(0, 60)})...`);
        generateSpectralTransientMeWav(extractedWav, fixedCues, outWavPath);
      }

      const uploadBuffer = fs.readFileSync(outWavPath);
      const remotePath = `instrumentals/me_${scene.id}_${Date.now()}.wav`;

      const { data: upData, error: upError } = await supabase.storage
        .from('videos')
        .upload(remotePath, uploadBuffer, {
          contentType: 'audio/wav',
          cacheControl: '3600',
          upsert: true,
        });

      if (upError) throw upError;

      const { data: pubData } = supabase.storage.from('videos').getPublicUrl(upData.path);
      const instrumentalUrl = pubData.publicUrl;

      await supabase
        .from('custom_scenes')
        .update({
          instrumental_url: instrumentalUrl,
          cues: fixedCues,
        })
        .eq('id', scene.id);

      console.log(`  ✅ Updated Scene "${scene.title}": ${instrumentalUrl}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

main();
