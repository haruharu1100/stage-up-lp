import type { SalesFitKey } from '../viability';
import type { JapanEvidence } from '../research/japan-evidence';
import type { JapanStage } from '../types';
import { japanGapFactor } from '../cluster';

/**
 * 出口（どうやって売るか）の採点。
 *
 * 同じ案件でも「noteで売る」「SaaSで売る」「運用代行で売る」で採算が全く変わる。
 * SaaSの採算だけで順位を付けると、開発が重くて月額化しにくいが情報としては価値が高い案件を
 * 取りこぼす。逆に、noteでは売れてもSaaSにできない案件を過大評価する。
 * そこで出口ごとに別の採点表を持ち、最後に「どの出口で出すか」を決める。
 *
 * 採点の原則は Money Score と同じ：
 *   実測も推定もできない項目は 0点ではなく「採点対象外」にして分母から外す（㉞）。
 *   分母（availableWeight）が小さい案件は、点が高いのではなく調べていないだけなので順位表に載せない。
 */

// ---------------------------------------------------------------------------
// 出口の種類
// ---------------------------------------------------------------------------

export type ExitKey = 'INFORMATION_PRODUCT' | 'SAAS' | 'SERVICE' | 'HYBRID';

export const EXIT_LABEL: Record<ExitKey, string> = {
  INFORMATION_PRODUCT: '情報を売る（note・PDF教材・テンプレ）',
  SAAS: '仕組みを売る（月額のAIシステム）',
  SERVICE: '手を動かして売る（運用代行・コンサル・制作代行）',
  HYBRID: '組み合わせて売る（無料note→有料note→無料デモ→AIシステム→運用代行）',
};

export const EXIT_DESCRIPTION: Record<ExitKey, string> = {
  INFORMATION_PRODUCT:
    '開発せずに文章だけで売れる。原価がほぼ無く利益率は一番高いが、1件の単価が小さく積み上がらない。',
  SAAS: '月額で積み上がるが、開発と保守が要る。売れるまでの時間も長い。',
  SERVICE: '単価は高く先に現金が入るが、自分の時間を売るので件数の上限がある。',
  HYBRID:
    '同じ1人の読者を、無料note→有料note→無料デモ→AIシステム→運用代行と何度も買ってもらう。' +
    '集客費を1回払えば複数回の売上になるため、獲得費の回収が最も速い。',
};

// ---------------------------------------------------------------------------
// 共通の採点部品
// ---------------------------------------------------------------------------

export type ScoreItem = {
  key: string;
  label: string;
  weight: number;
  /** 採点対象外なら null。0点と区別する */
  earned: number | null;
  basis: 'MEASURED' | 'BACKTEST' | 'ASSUMPTION' | 'NONE';
  reason: string;
};

export type ExitScore = {
  total: number;
  /** 採点できた配点の合計。100未満なら、その分だけ調べきれていない */
  availableWeight: number;
  items: ScoreItem[];
};

/**
 * 順位表に載せてよい最低ライン。
 * 10項目のうち2〜3項目しか採点できていない案件は、分母が小さいせいで点が高く出る。
 */
export const EXIT_MIN_WEIGHT = 50;

function build(defs: { key: string; label: string; weight: number }[], get: (key: string) => { ratio: number | null; basis: ScoreItem['basis']; reason: string }): ExitScore {
  const items: ScoreItem[] = defs.map((d) => {
    const v = get(d.key);
    return {
      key: d.key,
      label: d.label,
      weight: d.weight,
      earned: v.ratio === null ? null : Math.round(d.weight * clamp01(v.ratio) * 10) / 10,
      basis: v.basis,
      reason: v.reason,
    };
  });

  let earned = 0;
  let availableWeight = 0;
  for (const it of items) {
    if (it.earned === null) continue;
    earned += it.earned;
    availableWeight += it.weight;
  }
  const total = availableWeight === 0 ? 0 : Math.round((earned / availableWeight) * 1000) / 10;
  return { total, availableWeight, items };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** 件数を0〜1にならす。target件で満点。上振れは1で止める */
function volumeRatio(value: number, target: number): number {
  return clamp01(value / target);
}

// ---------------------------------------------------------------------------
// 入力
// ---------------------------------------------------------------------------

export type ExitContext = {
  /** 販売形態ごとの向き不向き（0〜100）。lib/viability.ts の fit をそのまま渡す */
  fit: Record<SalesFitKey, number> | null;
  /** 事業性スコアの各項目（0〜1）。採点できなかった項目は null */
  viability: Partial<Record<
    'willingnessToPay' | 'subscribable' | 'replacesLabor' | 'roiExplainable' | 'stickiness' |
    'prospectFindability' | 'mvpEase' | 'apiCost' | 'grossMargin' | 'dealSize',
    number | null
  >>;
  japan: { stage: JapanStage; confidence: number } | null;
  /** 日本市場調査の8指標。noteやYouTubeの情報量はここから取る */
  evidence: JapanEvidence | null;
  /** 海外の言及数の成長倍率。取れなければ null */
  growthRatio: number | null;
  /** 販売シミュレーションが成立しているか。していなければ金額を使わない */
  sales: { usable: boolean; ltvCac: number | null; monthlyPrice: number | null } | null;
  /** 案件のタイトル。対象読者が明記されているかを機械的に見るために使う */
  title: string;
};

/** 事業性スコアの項目を0〜1で取り出す。無ければ null（0にしない） */
function v(ctx: ExitContext, key: keyof ExitContext['viability']): number | null {
  const x = ctx.viability[key];
  return x === null || x === undefined ? null : clamp01(x);
}

/** 販売形態の向き（0〜100）を0〜1で取り出す */
function fitOf(ctx: ExitContext, key: SalesFitKey): number | null {
  return ctx.fit === null ? null : clamp01(ctx.fit[key] / 100);
}

/** 日本市場の空き度 × 調査の確度。調べていなければ null */
function gapOf(ctx: ExitContext): number | null {
  if (!ctx.japan) return null;
  const g = japanGapFactor(ctx.japan.stage);
  if (g === null) return null;
  return g * ctx.japan.confidence;
}

/** 8指標のうち1つを、実測できていれば件数で返す */
function evidenceValue(ctx: ExitContext, key: string): number | null {
  const s = ctx.evidence?.signals.find((x) => x.key === key);
  return s && s.status === 'MEASURED' ? s.value : null;
}

// ---------------------------------------------------------------------------
// NOTE BUSINESS SCORE（noteの記事として売れるか）
// ---------------------------------------------------------------------------

export type NoteKey =
  | 'generalInterest'
  | 'titleEase'
  | 'numbersProvable'
  | 'practicality'
  | 'beginnerDemand'
  | 'rarity'
  | 'overseasLead'
  | 'shareability'
  | 'paidPartFeasible'
  | 'saasHandoff';

export const NOTE_ITEMS: { key: NoteKey; label: string; weight: number }[] = [
  { key: 'generalInterest', label: '一般ユーザーの興味', weight: 10 },
  { key: 'titleEase', label: 'タイトルの作りやすさ', weight: 10 },
  { key: 'numbersProvable', label: '数字で成果を示せるか', weight: 10 },
  { key: 'practicality', label: '実践可能性', weight: 10 },
  { key: 'beginnerDemand', label: '初心者需要', weight: 10 },
  { key: 'rarity', label: '情報希少性', weight: 10 },
  { key: 'overseasLead', label: '海外先行性', weight: 10 },
  { key: 'shareability', label: 'SNS拡散性', weight: 10 },
  { key: 'paidPartFeasible', label: '有料部分を作れるか', weight: 10 },
  { key: 'saasHandoff', label: 'SaaSへ誘導できるか', weight: 10 },
];

/**
 * タイトルに「誰向けか」が書いてあるか。
 * 「配管業者向けAI受付」は読者が自分事にできるが、「AI Voice Agent」は誰の話か分からない。
 * これは文字の有無を数えるだけで、内容の良し悪しをAIに判断させてはいない。
 */
const AUDIENCE_WORDS = [
  '向け', 'のための', ' for ', 'for ', '業者', '店舗', '会社', '企業', '中小', '個人',
  'clinic', 'restaurant', 'salon', 'agency', 'contractor', 'plumber', 'dentist', 'realtor',
  'smb', 'small business', 'startup', 'team',
];

export function computeNoteScore(ctx: ExitContext): ExitScore {
  const title = ctx.title.toLowerCase();
  const hasAudience = AUDIENCE_WORDS.some((w) => title.includes(w.toLowerCase()));

  return build(NOTE_ITEMS, (key) => {
    switch (key as NoteKey) {
      case 'generalInterest': {
        // noteとYouTubeにどれだけ話題があるか。話題が全く無い＝需要も無いと見る
        const note = evidenceValue(ctx, 'NOTE_VOLUME');
        const yt = evidenceValue(ctx, 'YOUTUBE_VOLUME');
        if (note === null && yt === null) {
          return { ratio: null, basis: 'NONE' as const, reason: 'noteとYouTubeの情報量を測れていない（0件ではない）' };
        }
        const total = (note ?? 0) + (yt ?? 0);
        return {
          ratio: volumeRatio(total, 30),
          basis: 'MEASURED' as const,
          reason: `noteとYouTubeで合計${total}件の話題を実測（30件で満点）`,
        };
      }
      case 'titleEase':
        return {
          ratio: hasAudience ? 1 : 0.4,
          basis: 'ASSUMPTION' as const,
          reason: hasAudience
            ? 'タイトルに「誰向けか」が入っているため、読者が自分事にできる見出しを作れる'
            : 'タイトルに対象読者が書かれていないため、見出しで具体性を出しにくい',
        };
      case 'numbersProvable': {
        if (!ctx.sales?.usable) {
          return { ratio: null, basis: 'NONE' as const, reason: '販売シミュレーション未実施のため、記事に出せる数字がまだ無い' };
        }
        return {
          ratio: ctx.sales.monthlyPrice ? 1 : 0.5,
          basis: 'BACKTEST' as const,
          reason: '価格・粗利・回収月数を試算済みのため、記事に具体的な数字を出せる',
        };
      }
      case 'practicality': {
        const ease = v(ctx, 'mvpEase');
        return ease === null
          ? { ratio: null, basis: 'NONE' as const, reason: '作りやすさを判断する材料が無い' }
          : { ratio: ease, basis: 'ASSUMPTION' as const, reason: `読者が自分で再現できる難易度（MVPの作りやすさ ${Math.round(ease * 100)}点）` };
      }
      case 'beginnerDemand': {
        const labor = v(ctx, 'replacesLabor');
        const roi = v(ctx, 'roiExplainable');
        if (labor === null && roi === null) {
          return { ratio: null, basis: 'NONE' as const, reason: '初心者需要を判断する材料が無い' };
        }
        const vals = [labor, roi].filter((x): x is number => x !== null);
        return {
          ratio: vals.reduce((a, b) => a + b, 0) / vals.length,
          basis: 'ASSUMPTION' as const,
          reason: '人の作業を置き換えられて効果を説明しやすいほど、初心者にも刺さると見る',
        };
      }
      case 'rarity': {
        const gap = gapOf(ctx);
        return gap === null
          ? { ratio: null, basis: 'NONE' as const, reason: '日本市場を調べていないため、情報の希少性を判定できない' }
          : { ratio: gap, basis: 'MEASURED' as const, reason: `日本の空き度 × 調査の確度 = ${Math.round(gap * 100) / 100}（空いているほど、まだ誰も書いていない）` };
      }
      case 'overseasLead': {
        if (ctx.growthRatio === null) {
          return { ratio: null, basis: 'NONE' as const, reason: '海外の伸びを測れていない（0倍ではない）' };
        }
        return {
          ratio: volumeRatio(ctx.growthRatio, 3),
          basis: 'MEASURED' as const,
          reason: `海外の言及数が${Math.round(ctx.growthRatio * 100) / 100}倍（3倍で満点。海外が先行しているほど日本では新情報になる）`,
        };
      }
      case 'shareability': {
        const yt = evidenceValue(ctx, 'YOUTUBE_VOLUME');
        const x = fitOf(ctx, 'x');
        if (yt === null && x === null) {
          return { ratio: null, basis: 'NONE' as const, reason: '拡散のしやすさを判断する材料が無い' };
        }
        if (yt === null) {
          return { ratio: x as number, basis: 'ASSUMPTION' as const, reason: 'X投稿の向き不向きから推定（YouTubeの情報量は未取得）' };
        }
        return {
          ratio: volumeRatio(yt, 20),
          basis: 'MEASURED' as const,
          reason: `YouTubeに${yt}件（20件で満点。動画になっている話題は文章でも拡散しやすい）`,
        };
      }
      case 'paidPartFeasible': {
        const p = fitOf(ctx, 'paidNote');
        return p === null
          ? { ratio: null, basis: 'NONE' as const, reason: '販売形態の適性を出せていない' }
          : { ratio: p, basis: 'ASSUMPTION' as const, reason: `有料note適性 ${Math.round(p * 100)}点（手順・テンプレとして切り出せるか）` };
      }
      case 'saasHandoff': {
        const s = fitOf(ctx, 'saas');
        return s === null
          ? { ratio: null, basis: 'NONE' as const, reason: '販売形態の適性を出せていない' }
          : { ratio: s, basis: 'ASSUMPTION' as const, reason: `SaaS適性 ${Math.round(s * 100)}点（記事の読者を月額商品へ渡せるか）` };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// HYBRID SCORE（無料→有料→デモ→システム→代行 と積み上げられるか）
// ---------------------------------------------------------------------------

export type HybridKey =
  | 'freeContentDemand'
  | 'noteSalable'
  | 'saasSalable'
  | 'recurring'
  | 'upsell'
  | 'crossSell'
  | 'ltv'
  | 'salesEase'
  | 'devEase'
  | 'continuingDemand';

export const HYBRID_ITEMS: { key: HybridKey; label: string; weight: number }[] = [
  { key: 'freeContentDemand', label: '無料コンテンツ需要', weight: 10 },
  { key: 'noteSalable', label: 'note販売可能性', weight: 10 },
  { key: 'saasSalable', label: 'SaaS販売可能性', weight: 10 },
  { key: 'recurring', label: '月額化', weight: 10 },
  { key: 'upsell', label: 'Upsell（上位商品へ上げられるか）', weight: 10 },
  { key: 'crossSell', label: 'Cross-sell（別商品も売れるか）', weight: 10 },
  { key: 'ltv', label: '顧客LTV', weight: 10 },
  { key: 'salesEase', label: '営業容易性', weight: 10 },
  { key: 'devEase', label: '開発容易性', weight: 10 },
  { key: 'continuingDemand', label: '継続需要', weight: 10 },
];

export function computeHybridScore(ctx: ExitContext, noteScore: ExitScore): ExitScore {
  const avg = (...xs: (number | null)[]) => {
    const vals = xs.filter((x): x is number => x !== null);
    return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  return build(HYBRID_ITEMS, (key) => {
    switch (key as HybridKey) {
      case 'freeContentDemand': {
        const x = fitOf(ctx, 'x');
        const free = fitOf(ctx, 'freeNote');
        const r = avg(x, free);
        return r === null
          ? { ratio: null, basis: 'NONE' as const, reason: '無料コンテンツの向き不向きを出せていない' }
          : { ratio: r, basis: 'ASSUMPTION' as const, reason: 'X投稿と無料noteの適性の平均（入口に人を集められるか）' };
      }
      case 'noteSalable':
        return noteScore.availableWeight < EXIT_MIN_WEIGHT
          ? { ratio: null, basis: 'NONE' as const, reason: `note採点は10項目中${noteScore.availableWeight}点分しか採点できておらず、点数として使わない` }
          : { ratio: noteScore.total / 100, basis: 'ASSUMPTION' as const, reason: `NOTE BUSINESS SCORE ${noteScore.total}点` };
      case 'saasSalable': {
        const s = fitOf(ctx, 'saas');
        return s === null
          ? { ratio: null, basis: 'NONE' as const, reason: '販売形態の適性を出せていない' }
          : { ratio: s, basis: 'ASSUMPTION' as const, reason: `SaaS適性 ${Math.round(s * 100)}点` };
      }
      case 'recurring': {
        const r = v(ctx, 'subscribable');
        return r === null
          ? { ratio: null, basis: 'NONE' as const, reason: '月額化できるかを判断する材料が無い' }
          : { ratio: r, basis: 'ASSUMPTION' as const, reason: `月額化のしやすさ ${Math.round(r * 100)}点（毎月使う業務か、単発か）` };
      }
      case 'upsell': {
        // 有料note を買った人へ、より高い AI社員・運用代行 を出せるか
        const r = avg(fitOf(ctx, 'aiStaff'), fitOf(ctx, 'managedService'));
        return r === null
          ? { ratio: null, basis: 'NONE' as const, reason: '上位商品の適性を出せていない' }
          : { ratio: r, basis: 'ASSUMPTION' as const, reason: 'AI社員・運用代行の適性の平均（買った人へさらに高い商品を出せるか）' };
      }
      case 'crossSell': {
        const r = avg(fitOf(ctx, 'consulting'), fitOf(ctx, 'template'), fitOf(ctx, 'pdfCourse'));
        return r === null
          ? { ratio: null, basis: 'NONE' as const, reason: '横に広げる商品の適性を出せていない' }
          : { ratio: r, basis: 'ASSUMPTION' as const, reason: 'コンサル・テンプレ・PDF教材の適性の平均（同じ顧客へ別の商品を出せるか）' };
      }
      case 'ltv': {
        if (!ctx.sales?.usable || ctx.sales.ltvCac === null) {
          return { ratio: null, basis: 'NONE' as const, reason: 'LTVを計算できていない（0円ではない）' };
        }
        return {
          ratio: volumeRatio(ctx.sales.ltvCac, 5),
          basis: 'BACKTEST' as const,
          reason: `LTV÷CAC ${ctx.sales.ltvCac}倍（目標3倍・5倍で満点）`,
        };
      }
      case 'salesEase': {
        const r = avg(v(ctx, 'prospectFindability'), v(ctx, 'willingnessToPay'));
        return r === null
          ? { ratio: null, basis: 'NONE' as const, reason: '売りやすさを判断する材料が無い' }
          : { ratio: r, basis: 'ASSUMPTION' as const, reason: '営業先の探しやすさと支払い動機の平均' };
      }
      case 'devEase': {
        const r = avg(v(ctx, 'mvpEase'), v(ctx, 'apiCost'));
        return r === null
          ? { ratio: null, basis: 'NONE' as const, reason: '開発の重さを判断する材料が無い' }
          : { ratio: r, basis: 'ASSUMPTION' as const, reason: 'MVPの作りやすさとAPIコストの軽さの平均' };
      }
      case 'continuingDemand': {
        const r = v(ctx, 'stickiness');
        return r === null
          ? { ratio: null, basis: 'NONE' as const, reason: '継続需要を判断する材料が無い' }
          : { ratio: r, basis: 'ASSUMPTION' as const, reason: `解約されにくさ ${Math.round(r * 100)}点（一度入れたら使い続ける業務か）` };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// どの出口で出すかを決める
// ---------------------------------------------------------------------------

/** この点数を超えた出口を「出せる」と見なす */
export const EXIT_THRESHOLD = 60;

/**
 * 有料noteとして切り出せる最低ライン（100点満点の適性）。
 *
 * NOTE BUSINESS SCORE は10項目の平均なので、「有料部分を作れるか」が0点でも
 * 他の9項目が高ければ合格ラインを超えてしまう。だが有料部分が作れない案件は、
 * どれだけ話題性があっても有料noteとしては売れない。平均で隠れない足切りを別に置く。
 */
export const PAID_NOTE_FLOOR = 40;

export type ExitDecision = {
  /** 材料が足りなければ null。「情報を売る」と決め打ちしない */
  exit: ExitKey | null;
  noteScore: ExitScore;
  hybridScore: ExitScore;
  /** 判定に使えた出口 */
  candidates: ExitKey[];
  reason: string;
};

export function decideExit(ctx: ExitContext, money100: number | null, moneyWeight: number): ExitDecision {
  const noteScore = computeNoteScore(ctx);
  const hybridScore = computeHybridScore(ctx, noteScore);

  const noteOk = noteScore.availableWeight >= EXIT_MIN_WEIGHT;
  const hybridOk = hybridScore.availableWeight >= EXIT_MIN_WEIGHT;
  const moneyOk = money100 !== null && moneyWeight >= 50;
  const serviceFit = fitOf(ctx, 'managedService');
  const consultFit = fitOf(ctx, 'consulting');

  if (!noteOk && !hybridOk && !moneyOk) {
    return {
      exit: null,
      noteScore,
      hybridScore,
      candidates: [],
      reason:
        '出口を決めるだけの材料が揃っていない。' +
        `note採点${noteScore.availableWeight}点分／総合採点${hybridScore.availableWeight}点分／採算${moneyOk ? '算出済み' : '未算出'}。` +
        'この段階で「noteで売れる」「SaaSで売れる」とは判定しない。',
    };
  }

  const paidNote = fitOf(ctx, 'paidNote');
  // 有料部分を切り出せない案件は、話題性が高くても有料noteにはならない
  const paidNoteOk = paidNote === null || paidNote * 100 >= PAID_NOTE_FLOOR;

  const candidates: ExitKey[] = [];
  if (noteOk && noteScore.total >= EXIT_THRESHOLD && paidNoteOk) candidates.push('INFORMATION_PRODUCT');
  if (moneyOk && (money100 as number) >= EXIT_THRESHOLD) candidates.push('SAAS');
  if (serviceFit !== null && consultFit !== null && Math.max(serviceFit, consultFit) * 100 >= EXIT_THRESHOLD) {
    candidates.push('SERVICE');
  }

  /**
   * HYBRID は「情報でも仕組みでも売れる」時にだけ成立する。
   * 片方しか売れないのに HYBRID と呼ぶと、実際には作れない導線を前提に採算を出してしまう。
   */
  const isHybrid =
    hybridOk &&
    hybridScore.total >= EXIT_THRESHOLD &&
    candidates.includes('INFORMATION_PRODUCT') &&
    (candidates.includes('SAAS') || candidates.includes('SERVICE'));

  if (isHybrid) {
    return {
      exit: 'HYBRID',
      noteScore,
      hybridScore,
      candidates: [...candidates, 'HYBRID'],
      reason:
        `情報（note ${noteScore.total}点）でも仕組み（採算 ${money100}点）でも売れるため、組み合わせて売る。` +
        `同じ読者に何度も買ってもらえる分だけ集客費の回収が速い（総合 ${hybridScore.total}点）。`,
    };
  }

  if (candidates.length === 0) {
    return {
      exit: null,
      noteScore,
      hybridScore,
      candidates,
      reason:
        `どの出口も合格ライン${EXIT_THRESHOLD}点に届いていない` +
        `（note ${noteOk ? noteScore.total : '採点不足'}／採算 ${moneyOk ? money100 : '未算出'}）。` +
        (paidNoteOk ? '' : `有料noteとして切り出せる適性が${PAID_NOTE_FLOOR}点未満のため、話題性が高くても情報商品にはしない。`) +
        '売り方を決めない。',
    };
  }

  const exit = candidates[0];
  return {
    exit,
    noteScore,
    hybridScore,
    candidates,
    reason:
      `${EXIT_LABEL[exit]}だけが合格ライン${EXIT_THRESHOLD}点を超えた。` +
      `${EXIT_DESCRIPTION[exit]}`,
  };
}
