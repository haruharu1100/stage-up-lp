import { NextResponse } from 'next/server';
import { getStorage } from '@/lib/providers/storage';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const key = (params.key || []).join('/');
  const file = await getStorage().read(key);
  if (!file) return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 404 });
  return new NextResponse(file.data as any, {
    headers: { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=60' },
  });
}
