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
const localPython = path.join(process.cwd(), '.venv-splitter', 'bin', 'python3');
const splitterScript = path.join(process.cwd(), 'scripts', 'splitter_engine.py');

async function main() {
  const { data: scenes } = await supabase
    .from('custom_scenes')
    .select('*')
    .order('id');

  if (!scenes || scenes.length === 0) {
    console.log('No scenes found.');
    return;
  }

  for (const scene of scenes) {
    if (scene.instrumental_url && scene.instrumental_url.includes('pure_htdemucs_')) {
      console.log(`✅ [Already Pure htdemucs] ${scene.title}`);
      continue;
    }

    console.log(`\n🚀 Processing Scene [${scene.id}]: ${scene.title}`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `replik-htdemucs-${scene.id}-`));

    try {
      const videoPath = path.join(tmpDir, 'video.mp4');
      const extractedWav = path.join(tmpDir, 'extracted.wav');
      const outWavPath = path.join(tmpDir, 'no_vocals.wav');

      const vRes = await fetch(scene.video_url);
      fs.writeFileSync(videoPath, Buffer.from(await vRes.arrayBuffer()));

      execFileSync(
        '/opt/homebrew/bin/ffmpeg',
        ['-y', '-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', extractedWav],
        { stdio: 'ignore' },
      );

      execFileSync(localPython, [splitterScript, extractedWav, outWavPath], {
        stdio: 'inherit',
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
          TORCH_HOME: path.join(process.cwd(), '.venv-splitter', 'cache'),
        },
      });

      const uploadBuffer = fs.readFileSync(outWavPath);
      const remotePath = `instrumentals/pure_htdemucs_${scene.id}_${Date.now()}.wav`;

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
        .update({ instrumental_url: instrumentalUrl })
        .eq('id', scene.id);

      console.log(`  ✅ Updated Scene "${scene.title}": ${instrumentalUrl}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

void main();
