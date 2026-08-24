import path from 'node:path';
import fs from 'node:fs';
import { all, insert, newId, nowIso } from '../db/client';
import { getImageProvider } from '../providers/image';
import { getStorage } from '../providers/storage';
import { STORAGE_DIR } from '../env';
import type { RunLogger } from '../logger';
import type { ImagePlanItem, ListingPlan, ProductCore } from '../types';

export interface GeneratedImageRecord {
  id: string;
  slot: number;
  purpose: string;
  prompt: string;
  status: 'generated' | 'blocked' | 'error';
  filePath: string | null;
  url: string | null;
  blockedReason: string | null;
}

/**
 * AI社員04：画像制作担当。
 *
 * ★守っていること
 *  - 生成の入力に使うのは MASTER PRODUCT IMAGE（権利のある画像）だけ。
 *  - MASTER が無ければ画像を1枚も作らない（プロンプト案だけ保存して「要確認」で止める）。
 *  - 商品の形・色・容量・パッケージ表記を変えないよう、必ずMASTERを入力にした「編集」で作る。
 *  - メイン画像(1枚目)は加工せず MASTER をそのまま使う想定（Amazonのメイン画像は白背景・文字禁止）。
 */
export async function runImageMaker(
  runId: string,
  logger: RunLogger,
  product: ProductCore,
  plan: ListingPlan,
): Promise<GeneratedImageRecord[]> {
  const masters = await all(`SELECT * FROM master_images WHERE product_id = ? ORDER BY created_at ASC`, [product.id]);
  const provider = getImageProvider();
  const storage = getStorage();
  const out: GeneratedImageRecord[] = [];

  const slots = plan.imagePlan.length
    ? plan.imagePlan
    : DEFAULT_SLOTS.map((s) => ({ ...s, overlayText: [s.purpose], composition: s.intent }));

  if (!masters.length) {
    await logger.needsReview(
      'image',
      'CreativeGeneration',
      'MASTER PRODUCT IMAGE が未登録のため画像は作りませんでした。自社撮影・メーカー提供・問屋提供・許諾済みのいずれかの画像を登録してください（他社やAmazonの画像の流用は著作権侵害です）',
    );
  }

  for (const slot of slots) {
    const prompt = buildPrompt(product, slot);
    const id = newId('img');

    if (!masters.length || !provider.isReal) {
      const reason = !masters.length
        ? 'MASTER PRODUCT IMAGE が未登録（権利のある元画像なしに商品画像は作れません）'
        : '画像生成が未接続（OPENAI_API_KEY 未設定 / OFFLINE_MODE）';
      await insert('generated_images', {
        id,
        product_id: product.id,
        run_id: runId,
        slot: slot.slot,
        purpose: slot.purpose,
        prompt,
        provider: provider.name,
        model: null,
        file_path: null,
        status: 'blocked',
        blocked_reason: reason,
        master_image_id: null,
        created_at: nowIso(),
      });
      out.push({ id, slot: slot.slot, purpose: slot.purpose, prompt, status: 'blocked', filePath: null, url: null, blockedReason: reason });
      continue;
    }

    try {
      const masterPaths = masters.slice(0, 2).map((m) => path.join(STORAGE_DIR, String(m.file_path)));
      const existing = masterPaths.filter((p) => fs.existsSync(p));
      const result = await provider.editFromMaster({ masterImagePaths: existing, prompt, size: '1024x1024' });
      const saved = await storage.put(`products/${product.id}/image_${slot.slot}.png`, result.data, result.mime);
      await insert('generated_images', {
        id,
        product_id: product.id,
        run_id: runId,
        slot: slot.slot,
        purpose: slot.purpose,
        prompt,
        provider: result.provider,
        model: result.model,
        file_path: saved.key,
        status: 'generated',
        master_image_id: String(masters[0].id),
        created_at: nowIso(),
      });
      out.push({ id, slot: slot.slot, purpose: slot.purpose, prompt, status: 'generated', filePath: saved.key, url: saved.url, blockedReason: null });
      await logger.log('image', 'info', `画像${slot.slot}（${slot.purpose}）を生成しました`);
    } catch (err: any) {
      const message = err?.message || String(err);
      await insert('generated_images', {
        id,
        product_id: product.id,
        run_id: runId,
        slot: slot.slot,
        purpose: slot.purpose,
        prompt,
        provider: provider.name,
        file_path: null,
        status: 'error',
        blocked_reason: message,
        created_at: nowIso(),
      });
      out.push({ id, slot: slot.slot, purpose: slot.purpose, prompt, status: 'error', filePath: null, url: null, blockedReason: message });
      await logger.log('image', 'warn', `画像${slot.slot}の生成に失敗：${message}`);
    }
  }

  return out;
}

const DEFAULT_SLOTS: ImagePlanItem[] = [
  { slot: 2, purpose: '特徴説明', intent: '商品の特徴を1枚で理解させる', overlayText: [], composition: '' },
  { slot: 3, purpose: '使用シーン', intent: '使う場面を想像させる', overlayText: [], composition: '' },
  { slot: 4, purpose: 'サイズ・容量', intent: '大きさの不安を消す', overlayText: [], composition: '' },
  { slot: 5, purpose: 'メリット', intent: '買う理由を短く伝える', overlayText: [], composition: '' },
  { slot: 6, purpose: '利用方法', intent: '使い方の手順を示す', overlayText: [], composition: '' },
  { slot: 7, purpose: '比較・まとめ', intent: '要点をまとめる', overlayText: [], composition: '' },
];

function buildPrompt(product: ProductCore, slot: ImagePlanItem): string {
  const facts = [
    `商品名：${product.title}`,
    product.brand ? `ブランド：${product.brand}` : '',
    product.weightG ? `重量：${product.weightG}g` : '',
    product.packageSizeCm ? `外寸：${product.packageSizeCm.length}×${product.packageSizeCm.width}×${product.packageSizeCm.height}cm` : '',
    product.storageMethod ? `保存方法：${product.storageMethod}` : '',
    product.shelfLifeDays ? `賞味期限：製造から約${product.shelfLifeDays}日` : '',
  ]
    .filter(Boolean)
    .join(' / ');

  return `Amazonの商品ページ用サブ画像（${slot.slot}枚目・${slot.purpose}）を作ります。

【入力画像】添付は自社が使用権を持つ商品の実物画像（MASTER PRODUCT IMAGE）です。
この商品の形・色・パッケージのデザインと印字・容量表記を1ミリも変えずに、そのまま使ってください。

【この画像の目的】${slot.intent || slot.purpose}
【構図】${slot.composition || '商品を主役にし、余白を広く取った清潔なレイアウト'}
【画像に入れる日本語の文字】${slot.overlayText.length ? slot.overlayText.join(' / ') : '（文字なし）'}
【商品の事実】${facts}

【仕上がりの条件】
・1:1の正方形。背景は明るく清潔で、商品が最も目立つこと。
・文字は太めのゴシック体で読みやすく、上下左右に十分な余白を取り、絶対に見切れさせない。
・情報を詰め込みすぎない。1枚で伝えることは1つに絞る。
・実物と違う色・形・サイズに見える演出をしない。`;
}
