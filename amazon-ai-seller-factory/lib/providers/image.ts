import fs from 'node:fs';
import { config, secret, str } from '../env';

/**
 * ImageProvider — 商品ページ画像の生成口。
 *
 * ★最重要ルール（守らないと権利侵害になる）
 *  - Amazonや他社の商品画像を絶対にコピー・入力に使わない。
 *  - 生成の入力に使えるのは MASTER PRODUCT IMAGE（自社撮影／メーカー提供／問屋提供／
 *    使用許可済み／自社が権利を持つ画像）だけ。
 *  - MASTER が無い場合は「画像を作らない」。プロンプト案だけ出して要確認で止める。
 *  - 商品の形・色・容量・内容量・パッケージ表記をAIが変えないよう、
 *    必ず MASTER を入力にした「編集」で作る（ゼロから生成しない）。
 */
export interface ImageGenRequest {
  masterImagePaths: string[];
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
}

export interface ImageGenResult {
  data: Buffer;
  mime: string;
  provider: string;
  model: string;
}

export interface ImageProvider {
  readonly name: string;
  readonly isReal: boolean;
  /** MASTER画像を入力にした編集生成。masterが空なら必ず例外 */
  editFromMaster(req: ImageGenRequest): Promise<ImageGenResult>;
}

export const IMAGE_SAFETY_SUFFIX = `
【厳守】
・入力画像の商品そのもの（形・色・パッケージのデザインと文字・容量表記）を一切変更しない。別商品に描き替えない。
・存在しない受賞マーク・認証マーク・他社ロゴ・キャラクターを描かない。
・「必ず」「絶対」「日本一」「No.1」「最安値」等の断定・最上級の文字を入れない。
・病気が治る/予防できる等の医療的な効果を示す文字や図を入れない。
・文字を入れる場合は日本語を誤字なく、上下左右に余白を取り、絶対に見切れさせない。
・画像内の文字は、与えられた事実の範囲内だけを書く。数値を勝手に作らない。
`.trim();

class OpenAiImageProvider implements ImageProvider {
  readonly name = 'openai';
  readonly isReal = true;
  private model = str('OPENAI_IMAGE_MODEL', 'gpt-image-2');
  private quality = str('OPENAI_IMAGE_QUALITY', 'medium');

  constructor(private apiKey: string) {}

  async editFromMaster(req: ImageGenRequest): Promise<ImageGenResult> {
    if (!req.masterImagePaths.length) {
      throw new Error('MASTER PRODUCT IMAGE がありません。権利のある元画像なしに商品画像は作りません。');
    }
    const form = new FormData();
    form.append('model', this.model);
    form.append('prompt', `${req.prompt}\n\n${IMAGE_SAFETY_SUFFIX}`);
    form.append('size', req.size || '1024x1024');
    form.append('quality', this.quality);
    for (const p of req.masterImagePaths) {
      const buf = fs.readFileSync(p);
      const ext = p.toLowerCase().endsWith('.jpg') || p.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
      form.append('image[]', new Blob([new Uint8Array(buf)], { type: `image/${ext}` }), `master.${ext}`);
    }

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(580_000),
    });
    if (!res.ok) throw new Error(`OpenAI images.edits ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI images.edits: 画像が返りませんでした');
    return { data: Buffer.from(b64, 'base64'), mime: 'image/png', provider: this.name, model: this.model };
  }
}

/** 鍵が無い時。画像は作らず、必ず例外で止める（偽の商品画像を作らないため） */
class MockImageProvider implements ImageProvider {
  readonly name = 'mock';
  readonly isReal = false;
  async editFromMaster(): Promise<ImageGenResult> {
    throw new Error('画像生成は未接続です（OPENAI_API_KEY 未設定 / OFFLINE_MODE）。プロンプト案のみ保存しました。');
  }
}

export function getImageProvider(): ImageProvider {
  const want = str('IMAGE_PROVIDER', 'auto');
  if (config.offline || want === 'mock') return new MockImageProvider();
  const key = secret('OPENAI_API_KEY');
  if (want === 'openai') return key ? new OpenAiImageProvider(key) : new MockImageProvider();
  return key ? new OpenAiImageProvider(key) : new MockImageProvider();
}
