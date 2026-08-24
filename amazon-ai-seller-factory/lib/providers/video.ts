import fs from 'node:fs';
import { config, secret, str } from '../env';

/**
 * VideoProvider — 動画生成の差し替え口。特定サービスに依存させない。
 * MVPでは「構成・絵コンテ・ナレーション・テロップ・生成プロンプト」までを作り、
 * 実レンダリングは鍵が入った Adapter に generateVideo() を呼ばせるだけにしてある。
 */
export interface VideoGenRequest {
  prompt: string;
  masterImagePath?: string | null;
  durationSec: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
}

export interface VideoGenResult {
  status: 'planned' | 'rendered';
  data?: Buffer;
  mime?: string;
  provider: string;
  model?: string;
  note?: string;
}

export interface VideoProvider {
  readonly name: string;
  readonly isReal: boolean;
  generateVideo(req: VideoGenRequest): Promise<VideoGenResult>;
}

class PlanOnlyVideoProvider implements VideoProvider {
  readonly name = 'plan-only';
  readonly isReal = false;
  async generateVideo(): Promise<VideoGenResult> {
    return {
      status: 'planned',
      provider: this.name,
      note: '動画の構成・絵コンテ・プロンプトまで作成しました。実際の動画生成は VIDEO_PROVIDER と鍵の設定後に有効化されます。',
    };
  }
}

/** fal.ai（image-to-video）。FAL_KEY が入ったら自動で本物になる */
class FalVideoProvider implements VideoProvider {
  readonly name = 'fal';
  readonly isReal = true;
  private model = str('FAL_VIDEO_MODEL', 'fal-ai/kling-video/v1.6/standard/image-to-video');
  constructor(private key: string) {}

  async generateVideo(req: VideoGenRequest): Promise<VideoGenResult> {
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      duration: String(Math.min(10, Math.max(5, Math.round(req.durationSec)))),
      aspect_ratio: req.aspectRatio || '9:16',
    };
    if (req.masterImagePath && fs.existsSync(req.masterImagePath)) {
      const b64 = fs.readFileSync(req.masterImagePath).toString('base64');
      body.image_url = `data:image/png;base64,${b64}`;
    }
    const res = await fetch(`https://fal.run/${this.model}`, {
      method: 'POST',
      headers: { Authorization: `Key ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(580_000),
    });
    if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    const url = json.video?.url || json.videos?.[0]?.url;
    if (!url) throw new Error('fal: 動画URLが返りませんでした');
    const file = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    const data = Buffer.from(await file.arrayBuffer());
    return { status: 'rendered', data, mime: 'video/mp4', provider: this.name, model: this.model };
  }
}

export function getVideoProvider(): VideoProvider {
  const want = str('VIDEO_PROVIDER', 'mock');
  if (config.offline) return new PlanOnlyVideoProvider();
  if (want === 'fal') {
    const key = secret('FAL_KEY');
    return key ? new FalVideoProvider(key) : new PlanOnlyVideoProvider();
  }
  return new PlanOnlyVideoProvider();
}
