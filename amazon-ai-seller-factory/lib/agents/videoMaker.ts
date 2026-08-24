import path from 'node:path';
import fs from 'node:fs';
import { all, insert, newId, nowIso } from '../db/client';
import { getLlmProvider, parseLlmJson, LLM_GUARDRAILS } from '../providers/llm';
import { getVideoProvider } from '../providers/video';
import { getStorage } from '../providers/storage';
import { scanText } from '../compliance';
import { STORAGE_DIR } from '../env';
import type { RunLogger } from '../logger';
import type { ListingPlan, ProductCore, ReviewAnalysisResult, VideoPlan } from '../types';

/**
 * AI社員05：動画担当。
 * MASTER PRODUCT IMAGE と分析結果から、15〜30秒の紹介動画の
 * 構成・絵コンテ・ナレーション・テロップ・生成プロンプトを作る。
 * 実レンダリングは VideoProvider（差し替え可能）に任せる。
 */
export async function runVideoMaker(
  runId: string,
  logger: RunLogger,
  product: ProductCore,
  plan: ListingPlan,
  review: ReviewAnalysisResult,
): Promise<{ id: string; videoPlan: VideoPlan; status: string; filePath: string | null }> {
  const llm = getLlmProvider();

  const mockJson = JSON.stringify({
    durationSec: 20,
    structure: [
      { sec: '0-3', scene: '悩みの提示', goal: '自分ごと化させる' },
      { sec: '3-8', scene: '商品の登場', goal: '何の商品かを一目で伝える' },
      { sec: '8-14', scene: '特徴と使い方', goal: '使う場面を想像させる' },
      { sec: '14-20', scene: 'まとめ', goal: '購入ボタンに進ませる' },
    ],
    storyboard: [
      { cut: 1, visual: '[サンプル] 生活シーンの引き画', camera: '固定', onScreenText: '[サンプル]' },
      { cut: 2, visual: '[サンプル] 商品のアップ', camera: 'ゆっくり寄る', onScreenText: '[サンプル]' },
    ],
    narration: ['[サンプル] ナレーション1', '[サンプル] ナレーション2'],
    telop: ['[サンプル] テロップ1'],
    generationPrompts: [{ cut: 1, prompt: '[サンプル] 生成プロンプト', negativePrompt: '文字化け, 手の破綻' }],
  });

  const started = Date.now();
  const res = await llm.complete({
    system: `あなたはAmazonの商品紹介動画（15〜30秒）を設計する映像ディレクターです。${LLM_GUARDRAILS}
・与えられた事実にない性能・効果を映像でも文字でも表現しない。
・冒頭2秒で「誰の何の悩みか」を出す。最後は商品名と要点で締める。
・テロップは全角14文字以内。画面の端から余白を取る。`,
    user: `商品「${product.title}」の紹介動画を設計してください。

【企画の狙い】${plan.videoPlanBrief || plan.targetPersona}
【買う理由】${(plan.purchaseReasons || []).join(' / ')}
【レビューから分かった不満】${(review.complaints || []).join(' / ')}
【レビューから分かった購入理由】${(review.purchaseReasons || []).join(' / ')}
【商品の事実】${JSON.stringify({
      重量g: product.weightG,
      サイズcm: product.packageSizeCm,
      保存方法: product.storageMethod,
      賞味期限日数: product.shelfLifeDays,
    })}

出力は次のJSONのみ:
{"durationSec":20,
"structure":[{"sec":"0-3","scene":"","goal":""}],
"storyboard":[{"cut":1,"visual":"","camera":"","onScreenText":""}],
"narration":[""],"telop":[""],
"generationPrompts":[{"cut":1,"prompt":"","negativePrompt":""}]}

__MOCK_JSON__
${mockJson}`,
    maxTokens: 4000,
  });
  await logger.usage('video', res.provider, res.tokensIn, res.tokensOut, Date.now() - started);

  const parsed = parseLlmJson<Partial<VideoPlan>>(res.text, {});
  const videoPlan: VideoPlan = {
    durationSec: Math.min(30, Math.max(15, parsed.durationSec || 20)),
    structure: parsed.structure || [],
    storyboard: parsed.storyboard || [],
    narration: parsed.narration || [],
    telop: parsed.telop || [],
    generationPrompts: parsed.generationPrompts || [],
  };

  const flagged = scanText([...videoPlan.narration, ...videoPlan.telop].join('\n'));
  if (flagged.length) {
    await logger.needsReview('video', 'CreativeGeneration', `動画の文言にNG表現：${flagged.map((f) => f.word).join('、')}`);
  }

  // --- 実レンダリング（Adapterが本物の時だけ）------------------------
  const provider = getVideoProvider();
  let status = 'planned';
  let filePath: string | null = null;
  try {
    const masters = await all(`SELECT file_path FROM master_images WHERE product_id = ? LIMIT 1`, [product.id]);
    const masterPath = masters.length ? path.join(STORAGE_DIR, String(masters[0].file_path)) : null;
    const result = await provider.generateVideo({
      prompt: videoPlan.generationPrompts[0]?.prompt || plan.videoPlanBrief || product.title,
      masterImagePath: masterPath && fs.existsSync(masterPath) ? masterPath : null,
      durationSec: videoPlan.durationSec,
      aspectRatio: '9:16',
    });
    if (result.status === 'rendered' && result.data) {
      const saved = await getStorage().put(`products/${product.id}/promo.mp4`, result.data, result.mime || 'video/mp4');
      filePath = saved.key;
      status = 'rendered';
    } else {
      await logger.log('video', 'info', result.note || '動画は企画までを作成しました');
    }
  } catch (err: any) {
    await logger.log('video', 'warn', `動画生成をスキップ：${err?.message || err}`);
  }

  const id = newId('vid');
  await insert('generated_videos', {
    id,
    product_id: product.id,
    run_id: runId,
    duration_sec: videoPlan.durationSec,
    structure: JSON.stringify(videoPlan.structure),
    storyboard: JSON.stringify(videoPlan.storyboard),
    narration: JSON.stringify(videoPlan.narration),
    telop: JSON.stringify(videoPlan.telop),
    generation_prompts: JSON.stringify(videoPlan.generationPrompts),
    provider: provider.name,
    file_path: filePath,
    status,
    created_at: nowIso(),
  });

  await logger.log('video', 'info', `動画企画を作成（${videoPlan.durationSec}秒／カット${videoPlan.storyboard.length}）`);
  return { id, videoPlan, status, filePath };
}
