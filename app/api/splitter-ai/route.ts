import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { supabase } from '@/lib/supabase';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';
export const maxDuration = 300;

async function findBinary(candidates: string[]): Promise<string> {
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {}
  }
  return candidates[0];
}

/**
 * vocalremover.org / splitter-ai tarzı Gerçek AI Vokal & Efekt Ayrıştırıcı
 * Meta Hybrid Transformer Demucs v4 (htdemucs --two-stems=vocals) + FFmpeg
 * Orijinal konuşma sesini %100 ayırır, geriye sadece Müzik + Ses Efektleri + Ortam Sesleri (no_vocals.wav) bırakır.
 */
export async function POST(req: Request) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replik-splitter-'));
  try {
    const contentType = req.headers.get('content-type') || '';
    const inputPath = path.join(workDir, 'input_media');
    const wavPath = path.join(workDir, 'input_audio.wav');
    let sceneId = Date.now();

    if (contentType.includes('application/json')) {
      const body = (await req.json()) as { videoUrl?: string; sceneId?: number };
      if (!body.videoUrl) {
        return NextResponse.json({ error: 'videoUrl gerekli' }, { status: 400 });
      }
      if (body.sceneId) sceneId = Number(body.sceneId);
      const res = await fetch(body.videoUrl);
      if (!res.ok) {
        return NextResponse.json({ error: 'Video indirilemedi' }, { status: 400 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(inputPath, buf);
    } else {
      const urlObj = new URL(req.url);
      if (urlObj.searchParams.get('sceneId')) {
        sceneId = Number(urlObj.searchParams.get('sceneId'));
      }
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.byteLength === 0) {
        return NextResponse.json({ error: 'Boş medya verisi' }, { status: 400 });
      }
      await fs.writeFile(inputPath, buf);
    }

    const ffmpegBin = await findBinary([
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      'ffmpeg',
    ]);

    // 1. FFmpeg ile videodan 44.1kHz Stereo WAV çıkar
    await execFileAsync(ffmpegBin, [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '44100',
      '-ac',
      '2',
      wavPath,
    ]);

    const outDir = path.join(workDir, 'separated');
    const localPython = path.join(process.cwd(), '.venv-splitter', 'bin', 'python3');
    const splitterScript = path.join(process.cwd(), 'scripts', 'splitter_engine.py');
    const engineOutWav = path.join(workDir, 'splitter_clean.wav');

    let noVocalsWavPath: string | null = null;

    // 2. Local Python Splitter-AI (htdemucs --two-stems=vocals + Vocal Bleed Gate) çalıştır
    try {
      await fs.access(localPython);
      await execFileAsync(
        localPython,
        [splitterScript, wavPath, engineOutWav],
        {
          env: {
            ...process.env,
            PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
            TORCH_HOME: path.join(process.cwd(), '.venv-splitter', 'cache'),
          },
          timeout: 240000,
        },
      );

      await fs.access(engineOutWav);
      noVocalsWavPath = engineOutWav;
    } catch (localErr) {
      console.warn('[Splitter-AI] Local htdemucs uyarısı, bulut Demucs deneniyor:', localErr);
    }

    // 3. Eğer local python henüz kurulmadıysa veya hata verdiyse Bulut Demucs v4 (SAF no_vocals, orijinal ses karıştırmadan!)
    if (!noVocalsWavPath) {
      const wavBuffer = await fs.readFile(wavPath);
      const form = new FormData();
      form.append('files', new Blob([wavBuffer], { type: 'audio/wav' }), 'input_audio.wav');
      const upRes = await fetch('https://abidlabs-music-separation.hf.space/gradio_api/upload', {
        method: 'POST',
        body: form,
      });
      if (!upRes.ok) throw new Error('Bulut AI yükleme hatası');
      const uploaded = (await upRes.json()) as string[];
      const remotePath = uploaded[0];

      const callRes = await fetch(
        'https://abidlabs-music-separation.hf.space/gradio_api/call/inference',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: [
              {
                path: remotePath,
                url: `https://abidlabs-music-separation.hf.space/gradio_api/file=${remotePath}`,
                orig_name: 'input_audio.wav',
                meta: { _type: 'gradio.FileData' },
              },
            ],
          }),
        },
      );
      if (!callRes.ok) throw new Error('Bulut AI çağrı hatası');
      const { event_id } = (await callRes.json()) as { event_id: string };
      const sseRes = await fetch(
        `https://abidlabs-music-separation.hf.space/gradio_api/call/inference/${event_id}`,
      );
      const sseText = await sseRes.text();
      let noVocalsUrl = '';
      for (const line of sseText.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            if (Array.isArray(parsed) && parsed.length >= 2 && parsed[1]?.url) {
              noVocalsUrl = parsed[1].url;
            }
          } catch {}
        }
      }
      if (!noVocalsUrl) throw new Error('Bulut AI no_vocals üretemedi');
      const dl = await fetch(noVocalsUrl);
      const dlBuf = Buffer.from(await dl.arrayBuffer());
      const cloudOut = path.join(workDir, 'cloud_no_vocals.wav');
      await fs.writeFile(cloudOut, dlBuf);
      noVocalsWavPath = cloudOut;
    }

    // 4. Doğrudan yapay zekanın (htdemucs) ürettiği saf no_vocals.wav dosyasını oku
    const finalWavBuffer = await fs.readFile(noVocalsWavPath);

    // 5. Supabase Storage'a yükle ve URL'sini dön
    const storagePath = `instrumentals/splitter_${sceneId}_${Date.now()}.wav`;
    const { error: uploadError } = await supabase.storage
      .from('videos')
      .upload(storagePath, finalWavBuffer, {
        contentType: 'audio/wav',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Supabase yükleme hatası: ${uploadError.message}`);
    }

    const { data: pubUrl } = supabase.storage.from('videos').getPublicUrl(storagePath);

    return NextResponse.json({
      ok: true,
      engine: 'splitter-ai-htdemucs',
      instrumentalUrl: pubUrl.publicUrl,
    });
  } catch (err) {
    console.error('[Splitter-AI API Error]:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Vokal ayrıştırma hatası' },
      { status: 500 },
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
