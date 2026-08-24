import { NextResponse } from 'next/server';
import { insert, newId, nowIso, one } from '@/lib/db/client';
import { getStorage } from '@/lib/providers/storage';
import { SOURCE_TYPE_LABEL, type SourceType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ALLOWED_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/**
 * MASTER PRODUCT IMAGE の登録。
 * 権利区分（自社撮影／メーカー提供／問屋提供／使用許可／自社所有）の申告が無い画像は受け付けない。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const product = await one(`SELECT id FROM products WHERE id = ?`, [params.id]);
    if (!product) return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 });

    const form = await req.formData();
    const file = form.get('file');
    const rightsSource = String(form.get('rightsSource') || '');
    const rightsHolder = String(form.get('rightsHolder') || '').trim();
    const rightsEvidence = String(form.get('rightsEvidence') || '').trim();

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: '画像ファイルを選んでください' }, { status: 400 });
    }
    if (!(rightsSource in SOURCE_TYPE_LABEL)) {
      return NextResponse.json({ error: '画像の入手元（権利区分）を選んでください' }, { status: 400 });
    }
    if (!rightsHolder) {
      return NextResponse.json({ error: '権利者（撮影者・提供元）を入力してください' }, { status: 400 });
    }
    const ext = ALLOWED_MIME[file.type];
    if (!ext) return NextResponse.json({ error: 'PNG / JPEG / WebP のみ登録できます' }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const saved = await getStorage().put(`products/${params.id}/master_${Date.now()}${ext}`, buf, file.type);

    await insert('master_images', {
      id: newId('mi'),
      product_id: params.id,
      file_path: saved.key,
      mime: file.type,
      rights_source: rightsSource as SourceType,
      rights_holder: rightsHolder,
      rights_evidence: rightsEvidence || null,
      declared_by: 'admin',
      created_at: nowIso(),
    });

    return NextResponse.json({ ok: true, url: saved.url });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
