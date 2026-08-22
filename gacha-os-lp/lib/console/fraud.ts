/**
 * 不正登録の検知（MULTI-LAYER FRAUD DEFENSE）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ必要か
 * ═══════════════════════════════════════════════════════
 *
 * オンラインガチャには、
 *   新規登録キャンペーン / 紹介特典 / 無料ポイント / クーポン
 * があります。ここは必ず狙われます。
 *
 * 1人が100アカウントを作れば、100人分の新規特典を持っていかれます。
 * これは「不正アクセス」ではなく、正規の登録画面を正規の手順で使われるので、
 * WAF でもファイアウォールでも止まりません。入口で見分けるしかありません。
 *
 * メール認証だけでは足りません。捨てアドレスは無限に作れます。
 * SMS認証も、番号を買えば突破されますし、SMS送信自体に費用がかかるので
 * 「送らせること」自体が攻撃になります（SMS爆撃）。
 *
 * だから1つの決め手に頼らず、複数の観点を重ねて点数にします。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルの決まり（重要）
 * ═══════════════════════════════════════════════════════
 *
 *   1) 判定には必ず「理由」を付けること。
 *      点数だけ出して遮断するのは、運営者にとってブラックボックスです。
 *      「なぜこの人が止まったのか」を運営者が説明できない状態は、
 *      本当の不正を見逃すのと同じくらい危険です。
 *      お客様から問い合わせが来たとき、答えられなくなります。
 *
 *   2) 自動で「永久BAN」まで確定させないこと。
 *      このファイルが出すのは、あくまで
 *        通す / 追加認証を求める / 人が確認する / 登録を止める
 *      までです。アカウントを永久に潰す判断は、人が押します。
 *      誤検知は必ず起きます。取り返しのつく設計にしておくこと。
 *
 *   3) 1つの観点だけで BLOCK にしないこと。
 *      「同じIP」は、社員寮・学校・会社・大手キャリアの回線でも普通に起きます。
 *      「VPN」も、普通に使っている人がいます。
 *      単独では最大でも MEDIUM 止まりにし、重なったときだけ強くします。
 *      ここを雑にすると、善良なお客様を入口で追い返します。
 *
 *   4) 端末情報は、追跡のためではなく不正防止のために使うこと。
 *      利用目的をプライバシーポリシーに書き、必要な範囲を超えて集めないこと。
 */

/** 判定の段階。強い順に BLOCK > HIGH > MEDIUM > LOW */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCK";

/** 判定に対して、システムが取る対応 */
export type RiskAction =
  | "ALLOW"        // そのまま登録
  | "STEP_UP"      // 追加認証（SMS・CAPTCHA など）
  | "REVIEW"       // 登録保留。人が確認する
  | "DENY";        // 登録を止める（永久BANではない）

/**
 * 検知の観点。
 *
 * weight … 点数。重ねたときに効くよう、単独では BLOCK に届かない値にしてある
 * solo   … この観点だけで到達できる上限。善良な人を巻き込まないための蓋
 */
export type SignalKey =
  | "ipBurst"
  | "deviceReuse"
  | "signupSpeed"
  | "phoneReuse"
  | "emailPattern"
  | "anonymizer"
  | "botBehavior"
  | "uaAnomaly"
  | "requestBurst"
  | "smsRetry"
  | "referralRing"
  | "paymentReuse";

export type SignalDef = {
  key: SignalKey;
  /** 運営者の画面に出す名前 */
  label: string;
  weight: number;
  solo: RiskLevel;
  /** なぜこれが怪しいのか。管理画面のヘルプに出す */
  why: string;
};

export const SIGNALS: Record<SignalKey, SignalDef> = {
  ipBurst: {
    key: "ipBurst",
    label: "同一IPから短時間に大量登録",
    weight: 30,
    solo: "MEDIUM",
    why: "会社・学校・寮・キャリア回線でも同じIPになります。単独では止めず、他と重なったときに効かせます。",
  },
  deviceReuse: {
    key: "deviceReuse",
    label: "同じ端末から複数アカウント",
    weight: 34,
    solo: "MEDIUM",
    why: "家族で1台を使う場合があります。台数ではなく「短時間に何個作ったか」で見ます。",
  },
  signupSpeed: {
    key: "signupSpeed",
    label: "登録が人間の速度ではない",
    weight: 26,
    solo: "MEDIUM",
    why: "入力から送信までが数百ミリ秒など、手で打っていない速さ。自動化の強い手がかりです。",
  },
  phoneReuse: {
    key: "phoneReuse",
    label: "同じ電話番号の使い回し",
    weight: 38,
    solo: "MEDIUM",
    why: "SMS認証を通しても、番号が同じなら同一人物の可能性が高い。特典の重複取得に直結します。",
  },
  emailPattern: {
    key: "emailPattern",
    label: "機械的なメールアドレスの並び",
    weight: 22,
    solo: "LOW",
    why: "連番や、ドット・プラス記号で1つの受信箱に集約する書き方。単独では判断材料が弱いです。",
  },
  anonymizer: {
    key: "anonymizer",
    label: "VPN / Proxy / Tor 経由",
    weight: 20,
    solo: "LOW",
    why: "普通に使っている人が大勢います。これだけで止めないこと。組み合わせの材料としてのみ使います。",
  },
  botBehavior: {
    key: "botBehavior",
    label: "操作がBotらしい",
    weight: 32,
    solo: "MEDIUM",
    why: "マウスが動かない、画面のスクロールが無い、入力欄の移動が一定間隔など。",
  },
  uaAnomaly: {
    key: "uaAnomaly",
    label: "ブラウザ情報が不自然",
    weight: 24,
    solo: "LOW",
    why: "自動化ツール特有の名乗り、実在しない組み合わせ、極端に古い版など。",
  },
  requestBurst: {
    key: "requestBurst",
    label: "短時間の大量リクエスト",
    weight: 28,
    solo: "MEDIUM",
    why: "登録・ログイン・抽選のいずれかに、人の手では出せない回数が来ている状態。",
  },
  smsRetry: {
    key: "smsRetry",
    label: "SMSの再送を繰り返している",
    weight: 30,
    solo: "MEDIUM",
    why: "SMSは1通ごとに費用がかかります。突破目的だけでなく、費用を出させること自体が攻撃になります。",
  },
  referralRing: {
    key: "referralRing",
    label: "紹介が閉じた輪になっている",
    weight: 40,
    solo: "HIGH",
    why: "同じ数人の間だけで紹介し合い、特典を回している形。自作自演の典型です。",
  },
  paymentReuse: {
    key: "paymentReuse",
    label: "同じ決済手段が多数のアカウントに",
    weight: 42,
    solo: "HIGH",
    why: "同一カードが複数アカウントに紐づく状態。盗難カードの試し打ちの可能性もあります。",
  },
};

/** 点数の境目。ここだけを見て段階を決める */
export const THRESHOLD = {
  MEDIUM: 30,
  HIGH: 60,
  BLOCK: 95,
} as const;

const ORDER: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "BLOCK"];
const rank = (l: RiskLevel) => ORDER.indexOf(l);
const lower = (a: RiskLevel, b: RiskLevel) => (rank(a) <= rank(b) ? a : b);

export type Hit = {
  key: SignalKey;
  label: string;
  weight: number;
  /** 実際に観測された値。「同一IPから17アカウント」の 17 の部分 */
  detail: string;
};

export type Assessment = {
  score: number;
  level: RiskLevel;
  action: RiskAction;
  hits: Hit[];
  /** 運営者にそのまま見せる説明 */
  explain: string;
  /** 段階を1つ下げた場合、その理由（善良な人を巻き込まないための蓋が効いたとき） */
  cappedBy?: string;
};

/**
 * 観測された手がかりから、危険度を出す。
 *
 * ★点数の合計だけで決めないこと。
 *   「単独で強い観点が1つあるだけ」の場合は、その観点の solo 上限で頭を打たせます。
 *   たとえば VPN だけなら、点数がいくつであっても LOW を超えません。
 */
export function assess(hits: Hit[]): Assessment {
  const score = Math.min(100, hits.reduce((a, h) => a + h.weight, 0));

  let level: RiskLevel = "LOW";
  if (score >= THRESHOLD.BLOCK) level = "BLOCK";
  else if (score >= THRESHOLD.HIGH) level = "HIGH";
  else if (score >= THRESHOLD.MEDIUM) level = "MEDIUM";

  /* 観点が1つだけのときは、その観点の上限まで下げる */
  let cappedBy: string | undefined;
  if (hits.length === 1) {
    const def = SIGNALS[hits[0].key];
    const capped = lower(level, def.solo);
    if (capped !== level) {
      cappedBy = `${def.label} だけでは、${level} とは判定しません。${def.why}`;
      level = capped;
    }
  }

  /**
   * 登録を止める（BLOCK）には、観点が3つ以上重なっていること。
   *
   * ★なぜ点数だけで決めないのか
   *   点数は、あとから運営者が調整できる数字です。
   *   誰かが1つの観点の点数を大きくすれば、その観点だけで
   *   BLOCK に届いてしまう状態を作れてしまいます。
   *   そうなっても、ここで必ず止まるようにしておきます。
   *
   *   いまの点数の付け方では、2つ重ねても最大 82点 なので
   *   この蓋が実際に働くことはありません。
   *   それでも書いておくのは、点数を触った人が
   *   気づかないうちに「1つの手がかりで人を締め出す」状態を
   *   作らないようにするためです。
   *
   *   下げた先は HIGH（登録保留・人が確認する）です。
   *   自動で通すのではなく、人の目に回します。
   */
  if (level === "BLOCK" && hits.length < 3) {
    cappedBy =
      `手がかりが ${hits.length} つだけなので、登録は止めません。` +
      `点数は ${score} 点ですが、3つ以上重なっていない場合は、人が確認する扱いにします。`;
    level = "HIGH";
  }

  const action: RiskAction =
    level === "BLOCK" ? "DENY"
    : level === "HIGH" ? "REVIEW"
    : level === "MEDIUM" ? "STEP_UP"
    : "ALLOW";

  const explain =
    hits.length === 0
      ? "気になる点はありません。通常登録として通します。"
      : {
          LOW: "手がかりはありますが弱いため、通常登録として通します。記録だけ残します。",
          MEDIUM: "いくつか重なっているため、追加の本人確認をお願いします。",
          HIGH: "強い手がかりが重なっています。登録を保留し、運営者の確認を待ちます。",
          BLOCK: "不正の型に一致しています。登録を止めます（永久停止ではありません。運営者が解除できます）。",
        }[level];

  return { score, level, action, hits, explain, cappedBy };
}

/** 画面に出す色と日本語ラベル */
export const LEVEL_STYLE: Record<
  RiskLevel,
  { label: string; action: string; face: string; ink: string; edge: string }
> = {
  LOW: {
    label: "LOW",
    action: "通常登録",
    face: "bg-ok/10",
    ink: "text-ok-ink",
    edge: "border-ok/30",
  },
  MEDIUM: {
    label: "MEDIUM",
    action: "追加認証",
    face: "bg-warn/12",
    ink: "text-warn-ink",
    edge: "border-warn/35",
  },
  HIGH: {
    label: "HIGH",
    action: "登録保留・要確認",
    face: "bg-danger/10",
    ink: "text-danger-ink",
    edge: "border-danger/30",
  },
  BLOCK: {
    label: "BLOCK",
    action: "登録を止める",
    face: "bg-danger",
    ink: "text-white",
    edge: "border-danger",
  },
};
