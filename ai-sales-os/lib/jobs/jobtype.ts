/**
 * 案件の種類を決め、その種類なら最低これだけはかかる、という時間の下限を持つ。
 *
 * ★なぜ種類ごとに下限を置くか。
 *   いちばん危ないのは「作業時間を小さく見積もること」。
 *   AIが本文を書く時間は数分でも、案件そのものは数分では終わらない。
 *   打ち合わせ、素材の受け取り、確認、手直し、納品の形を整える時間が必ずかかる。
 *   時間を小さく見積もると、時間あたりの利益が実際よりずっと大きく出て、
 *   割に合わない案件が上位に並ぶ。上位に並んだ案件から手を付けるので、被害がそのまま出る。
 *
 * ★この下限は「実績から学んだ数字」ではない。まだ本物の案件が少ないので学べない。
 *   だから ここに置いてあるのは、安全側に倒した仮の下限。
 *   本物の案件の実時間が20件たまるまで、この数字は動かさない（少ない実績に合わせない）。
 *   合わせてしまうと、たまたま楽だった1件が全案件の基準になる。
 */

/** 16種類。ここに無い案件は OTHER にする（無理にどれかへ寄せない）。 */
export const JOB_TYPES = [
  'COPYWRITING',
  'SNS',
  'SEO',
  'ARTICLE',
  'LP',
  'WORDPRESS',
  'WEB_SYSTEM',
  'GAS',
  'AI_AUTOMATION',
  'DATA_ANALYSIS',
  'RESEARCH',
  'IMAGE',
  'VIDEO',
  'AMAZON_EC',
  'SALES',
  'OTHER',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

type TypeDef = {
  code: JobType;
  ja: string;
  /** この種類なら、どんなに小さくてもこれだけはかかる（時間）。安全側の仮置き。 */
  minHours: number;
  patterns: RegExp[];
  /** どういう仕事を指すか。画面にそのまま出す。 */
  whatJa: string;
};

/**
 * ★並び順に意味がある。上から順に当てて、最初に当たったものを採用する。
 *   「LP制作をWordPressで」のような案件は、重いほう（作るものが大きいほう）を先に置く。
 *   軽いほうに寄せると時間を小さく見積もることになる。
 */
const TYPE_DEFS: TypeDef[] = [
  {
    code: 'WEB_SYSTEM',
    ja: 'システム開発',
    minHours: 12,
    whatJa: 'Webアプリや業務システムなど、動くものを一から作る仕事',
    patterns: [/システム(開発|構築|制作)/, /Webアプリ/i, /業務システム/, /(React|Next\.?js|Vue|Laravel|Django|Rails)/i, /API(開発|連携|実装)/i, /データベース設計/],
  },
  {
    code: 'AI_AUTOMATION',
    ja: 'AI・自動化',
    minHours: 6,
    whatJa: 'AIやツールをつないで、人がやっていた作業を自動で回るようにする仕事',
    patterns: [/自動化/, /(ChatGPT|Claude|生成AI|AI).{0,8}(導入|活用|組み込|構築|開発)/i, /RPA/i, /(Make|Zapier|Dify|n8n)/i, /bot(開発|制作)/i, /チャットボット/],
  },
  {
    code: 'LP',
    ja: 'LP制作',
    minHours: 6,
    whatJa: '1ページで売る形のページを、構成から作る仕事',
    patterns: [/LP(制作|作成|デザイン|改善)?/i, /ランディングページ/, /セールスページ/],
  },
  {
    code: 'WORDPRESS',
    ja: 'WordPress',
    minHours: 4,
    whatJa: 'WordPressでサイトを作る・直す・移す仕事',
    patterns: [/WordPress/i, /ワードプレス/, /(テーマ|プラグイン)(カスタマイズ|開発|修正)/, /サーバー移行/],
  },
  {
    code: 'GAS',
    ja: 'GAS・スプレッドシート',
    minHours: 4,
    whatJa: 'Googleスプレッドシートやフォームを、自動で動くようにする仕事',
    patterns: [/GAS/i, /Google\s?Apps\s?Script/i, /スプレッドシート/, /Googleフォーム/, /(Excel|エクセル).{0,6}(マクロ|VBA|自動)/i],
  },
  {
    code: 'AMAZON_EC',
    ja: 'EC・Amazon',
    minHours: 3,
    whatJa: 'ネットショップの商品ページや出品まわりの仕事',
    patterns: [/Amazon/i, /楽天市場/, /(EC|ネットショップ|通販)(サイト|運営|構築)?/i, /商品ページ/, /(Shopify|BASE|STORES)/i, /出品(代行|作業)/],
  },
  {
    code: 'VIDEO',
    ja: '動画制作',
    minHours: 3,
    whatJa: '動画を編集する・作る仕事',
    patterns: [/動画(編集|制作|作成)/, /(YouTube|ショート|TikTok|Reels)/i, /テロップ/, /(Premiere|AfterEffects|AviUtl)/i],
  },
  {
    code: 'DATA_ANALYSIS',
    ja: 'データ分析',
    minHours: 3,
    whatJa: '集めた数字を整理して、何が起きているかを説明する仕事',
    patterns: [/データ(分析|集計|整理|加工)/, /(アクセス|売上|効果)(解析|分析)/, /GA4/i, /BI(ツール)?/i, /ダッシュボード(作成|構築)/],
  },
  {
    code: 'SEO',
    ja: 'SEO',
    minHours: 2,
    whatJa: '検索から人が来るようにする仕事',
    patterns: [/SEO/i, /検索(順位|流入|上位)/, /内部対策/, /キーワード(選定|調査)/],
  },
  {
    code: 'RESEARCH',
    ja: 'リサーチ',
    minHours: 2,
    whatJa: '調べてまとめる仕事',
    patterns: [/リサーチ/, /市場調査/, /競合(調査|分析)/, /情報収集/, /アンケート(集計|作成|調査)/],
  },
  {
    code: 'SALES',
    ja: '営業・アポ',
    minHours: 2,
    whatJa: '売る相手を見つけて話をつなぐ仕事',
    patterns: [/(営業|テレアポ|アポイント)(代行|支援)?/, /営業リスト/, /インサイドセールス/, /商談/],
  },
  {
    code: 'SNS',
    ja: 'SNS運用',
    minHours: 1.5,
    whatJa: 'SNSの投稿を作る・回す仕事',
    // ★「Instagramの投稿」のように助詞が挟まる書き方が実際には多い。
    //   「Instagram投稿」だけを見ていると、ふつうの日本語を取りこぼして「その他」に落ちる。
    patterns: [
      /SNS(運用|投稿|代行)?/i,
      /(X|Twitter|Instagram|インスタ|Threads|Facebook|LINE)(の|用)?(運用|投稿|アカウント)/i,
      /投稿(代行|作成|文)/,
    ],
  },
  {
    code: 'ARTICLE',
    ja: '記事作成',
    minHours: 1.5,
    whatJa: 'ブログやメディアの記事を書く仕事',
    patterns: [/記事(作成|執筆|制作|ライティング)/, /ブログ(記事|執筆)/, /コラム(執筆|作成)/, /(WEB|Web)ライティング/],
  },
  {
    code: 'IMAGE',
    ja: '画像制作',
    minHours: 1,
    whatJa: 'バナーやサムネイルなど、1枚の画像を作る仕事',
    patterns: [/バナー/, /サムネ(イル)?/, /(画像|イラスト|ロゴ)(制作|作成|デザイン)/, /アイキャッチ/, /(Photoshop|Illustrator|Canva)/i],
  },
  {
    code: 'COPYWRITING',
    ja: 'コピー・文章',
    minHours: 1,
    whatJa: 'キャッチコピーや紹介文など、短い文章を作る仕事',
    patterns: [/コピーライティング/, /キャッチ(コピー)?/, /セールスライティング/, /(紹介文|説明文|プロフィール文)(作成|執筆)?/, /ライティング/],
  },
];

export const JOB_TYPE_JA: Record<JobType, string> = {
  ...(Object.fromEntries(TYPE_DEFS.map((d) => [d.code, d.ja])) as Record<JobType, string>),
  OTHER: 'その他',
};

export const JOB_TYPE_WHAT_JA: Record<JobType, string> = {
  ...(Object.fromEntries(TYPE_DEFS.map((d) => [d.code, d.whatJa])) as Record<JobType, string>),
  OTHER: 'どの種類にも当てはまらなかった案件',
};

/** どの種類にも当たらなかったときの下限。楽なほうへは倒さない。 */
const OTHER_MIN_HOURS = 2;

export const JOB_TYPE_MIN_HOURS: Record<JobType, number> = {
  ...(Object.fromEntries(TYPE_DEFS.map((d) => [d.code, d.minHours])) as Record<JobType, number>),
  OTHER: OTHER_MIN_HOURS,
};

export type JobTypeVerdict = {
  type: JobType;
  typeJa: string;
  minHours: number;
  /** 判定の根拠になった本文の言葉。無ければ null（当てずっぽうで種類を決めない）。 */
  matchedText: string | null;
  reasonJa: string;
};

/** 案件文から種類を1つ決める。当たらなければ OTHER。 */
export function classifyJobType(text: string): JobTypeVerdict {
  for (const d of TYPE_DEFS) {
    for (const p of d.patterns) {
      const m = text.match(p);
      if (m) {
        return {
          type: d.code,
          typeJa: d.ja,
          minHours: d.minHours,
          matchedText: m[0],
          reasonJa: `本文の「${m[0]}」から「${d.ja}」と判断した。この種類は最低でも${d.minHours}時間はかかるものとして計算する。`,
        };
      }
    }
  }
  return {
    type: 'OTHER',
    typeJa: JOB_TYPE_JA.OTHER,
    minHours: OTHER_MIN_HOURS,
    matchedText: null,
    reasonJa: `どの種類の言葉も本文に出てこなかった。種類を決めつけず「その他」にして、最低${OTHER_MIN_HOURS}時間で計算する。`,
  };
}

// ---------------------------------------------------------------- 7つの工程

/**
 * 案件1件にかかる時間を7つに分ける。
 *
 * ★AIが生成する時間だけを「作業時間」と呼ばない。
 *   実際にかかるのは、下の7つ全部。AI生成はそのうちの1つでしかない。
 */
export const WORK_STAGES = [
  'UNDERSTAND',
  'MATERIAL',
  'GENERATE',
  'REVIEW',
  'FIX',
  'CLIENT',
  'DELIVER',
] as const;

export type WorkStage = (typeof WORK_STAGES)[number];

export const WORK_STAGE_JA: Record<WorkStage, string> = {
  UNDERSTAND: '案件理解（依頼文を読んで、何を作るか決める）',
  MATERIAL: '素材確認（資料・画像・アカウントなど、もらう物をそろえる）',
  GENERATE: 'AI生成（AIや自社の道具で実際に作る）',
  REVIEW: '人間確認（出てきた物を人が読んで、出せる状態か見る）',
  FIX: '修正（直しを入れる）',
  CLIENT: 'クライアント対応（質問への返事・進み具合の連絡）',
  DELIVER: '納品準備（形をそろえて渡す）',
};

/**
 * AI生成以外の6工程は、どんなに小さい案件でも必ずこれだけはかかる（時間）。
 * ★合計はちょうど0.5時間。これまで使ってきた「どの案件にも必ずかかる0.5時間」と同じ。
 *   内訳を出せるようにしただけで、下限は1分たりとも下げていない。
 */
export const STAGE_FLOOR_HOURS: Record<Exclude<WorkStage, 'GENERATE'>, number> = {
  UNDERSTAND: 0.1,
  MATERIAL: 0.05,
  REVIEW: 0.15,
  FIX: 0.1,
  CLIENT: 0.05,
  DELIVER: 0.05,
};

/** AI生成にかかる時間に対して、各工程がどれくらいかかるか（割合）。 */
const STAGE_RATIO: Record<Exclude<WorkStage, 'GENERATE'>, number> = {
  UNDERSTAND: 0.1,
  MATERIAL: 0.05,
  REVIEW: 0.2,
  FIX: 0.2,
  CLIENT: 0.05,
  DELIVER: 0.05,
};

/** 0.5時間（＝これまでの最低オーバーヘッド）。下げないことをテストで見張る。 */
export const MIN_OVERHEAD_HOURS = Number(
  Object.values(STAGE_FLOOR_HOURS).reduce((a, b) => a + b, 0).toFixed(2),
);

export type HourBreakdown = {
  stages: { stage: WorkStage; stageJa: string; hours: number }[];
  /** AI生成の時間 */
  generateHours: number;
  /** AI生成以外の6工程の合計 */
  overheadHours: number;
  /** 合計（種類ごとの下限を当てたあと） */
  totalHours: number;
  /** 種類ごとの下限で押し上げたか */
  raisedByTypeMin: boolean;
  noteJa: string;
};

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * AI生成時間から、7工程に分けた合計時間を作る。
 *
 * @param generateHours AIや自社の道具で作る時間
 * @param typeMinHours  その案件の種類の下限（classifyJobType の minHours）
 * @param revisionUnknown 修正回数が本文に書かれていないか。書かれていなければ手直しを1.5倍で見る。
 */
export function breakdownHours(
  generateHours: number,
  typeMinHours: number,
  revisionUnknown: boolean,
): HourBreakdown {
  const gen = round2(Math.max(0, generateHours));

  const stageHours: Record<Exclude<WorkStage, 'GENERATE'>, number> = {
    UNDERSTAND: 0,
    MATERIAL: 0,
    REVIEW: 0,
    FIX: 0,
    CLIENT: 0,
    DELIVER: 0,
  };
  for (const k of Object.keys(stageHours) as (keyof typeof stageHours)[]) {
    // ★修正回数が書いていない案件は、手直しが何回来るか読めない。
    //   読めないものを少なく見るのがいちばん危ないので、修正だけ1.5倍で見ておく。
    const bump = k === 'FIX' && revisionUnknown ? 1.5 : 1;
    stageHours[k] = round2(Math.max(STAGE_FLOOR_HOURS[k], gen * STAGE_RATIO[k]) * bump);
  }

  const overhead = round2(Object.values(stageHours).reduce((a, b) => a + b, 0));
  const raw = round2(gen + overhead);
  const total = round2(Math.max(raw, typeMinHours));
  const raised = total > raw;

  const stages: HourBreakdown['stages'] = [
    { stage: 'UNDERSTAND', stageJa: WORK_STAGE_JA.UNDERSTAND, hours: stageHours.UNDERSTAND },
    { stage: 'MATERIAL', stageJa: WORK_STAGE_JA.MATERIAL, hours: stageHours.MATERIAL },
    { stage: 'GENERATE', stageJa: WORK_STAGE_JA.GENERATE, hours: gen },
    { stage: 'REVIEW', stageJa: WORK_STAGE_JA.REVIEW, hours: stageHours.REVIEW },
    { stage: 'FIX', stageJa: WORK_STAGE_JA.FIX, hours: stageHours.FIX },
    { stage: 'CLIENT', stageJa: WORK_STAGE_JA.CLIENT, hours: stageHours.CLIENT },
    { stage: 'DELIVER', stageJa: WORK_STAGE_JA.DELIVER, hours: stageHours.DELIVER },
  ];

  const parts: string[] = [
    `AI生成${gen}時間＋その前後で${overhead}時間（案件理解・素材確認・人間確認・修正・やりとり・納品準備）`,
  ];
  if (revisionUnknown) parts.push('修正回数が本文に書かれていないので、手直しの時間を1.5倍で見ている');
  if (raised) parts.push(`この種類の案件は最低${typeMinHours}時間かかるものとして、そこまで引き上げた`);

  return {
    stages,
    generateHours: gen,
    overheadHours: overhead,
    totalHours: total,
    raisedByTypeMin: raised,
    noteJa: parts.join('／'),
  };
}
