import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
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
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream video fetch failed: ${upstream.status}` },
        { status: upstream.status },
      );
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await upstream.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Video proxy error' },
      { status: 500 },
    );
  }
}
