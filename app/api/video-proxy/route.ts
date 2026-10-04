import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const range = req.headers.get('range');
  if (range) {
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < Number(match[1])
      || Number(match[2]) - Number(match[1]) + 1 > 3 * 1024 * 1024) {
      return NextResponse.json({ error: 'Invalid video range' }, { status: 400 });
    }
  }
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid url parameter' }, { status: 400 });
  }

  // SSRF Koruması: Sadece HTTPS ve güvenli medya alan adlarına (*.supabase.co) izin ver
  if (
    parsedUrl.protocol !== 'https:' ||
    !parsedUrl.hostname.toLowerCase().endsWith('.supabase.co')
  ) {
    return NextResponse.json(
      { error: 'Yalnızca güvenli Supabase Storage medya bağlantılarına izin verilir.' },
      { status: 403 },
    );
  }

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      headers: {
        Accept: 'video/*,audio/*;q=0.8',
        ...(range ? { Range: range } : {}),
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream video fetch failed: ${upstream.status}` },
        { status: upstream.status },
      );
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    if (range && upstream.status !== 206 && Number(upstream.headers.get('content-length')) > 3 * 1024 * 1024) {
      return NextResponse.json({ error: 'Upstream does not support bounded video reads' }, { status: 502 });
    }
    const arrayBuffer = await upstream.arrayBuffer();
    if (range && arrayBuffer.byteLength > 3 * 1024 * 1024) {
      return NextResponse.json({ error: 'Upstream video range is too large' }, { status: 502 });
    }

    return new NextResponse(arrayBuffer, {
      status: upstream.status === 206 ? 206 : 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': range ? 'no-store' : 'public, max-age=3600',
        'Vary': 'Range',
        ...(upstream.headers.get('content-range') ? { 'Content-Range': upstream.headers.get('content-range')! } : {}),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Video proxy error' },
      { status: 500 },
    );
  }
}
