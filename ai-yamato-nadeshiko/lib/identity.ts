/**
 * Character Identity Object — キャラクターの「正体」を1か所に閉じ込める。
 *
 * ★なぜ文字列ではなくオブジェクトなのか
 *   名前を "Suzuho Awano" という 1本の文字列として持ち回すと、
 *   受け取った側が勝手に split したり、下の名前だけを取り出したり、
 *   LLMが「Suzuho Tanaka」のように姓を書き換えても誰も気付けない。
 *   正式名・下の名前・姓・状態を別のフィールドとして持ち、
 *   これをそのまま渡すことで「どれを使ってよい場面か」を型で扱えるようにする。
 *
 * ★名前と顔は別々に状態管理する
 *   IDENTITY_STATUS（名前）と REFERENCE_FACE_STATUS（基準顔）は独立している。
 *   名前が確定したからといって顔まで自動で確定しない。
 *   IDENTITY_STATUS=LOCKED かつ REFERENCE_FACE_STATUS=PENDING_HUMAN_SELECTION は正常な状態。
 *
 * 出典: 事業Vault/AI YAMATO NADESHIKO/01_CHARACTER/SUZUHO_AWANO_PROFILE.md
 *       事業Vault/AI YAMATO NADESHIKO/01_CHARACTER/名称候補調査.md
 */

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------

/**
 * 名前の状態。
 * - PROVISIONAL: 仮。商標調査が終わっていない。★この状態では本番公開しない
 * - LOCKED:      確定。以後この名前は変えない
 * - REJECTED:    重大な衝突が見つかった。名前候補フェーズへ戻す
 */
export type IdentityStatus = "PROVISIONAL" | "LOCKED" | "REJECTED";

/**
 * 基準顔の状態。名前とは独立して進む。
 * - NOT_GENERATED:            まだ候補を生成していない
 * - PENDING_HUMAN_SELECTION:  8枚の候補は出たが、人がまだ1枚を選んでいない
 * - LOCKED:                   人が1枚選び、以後の全投稿がこの顔に縛られる
 */
export type ReferenceFaceStatus = "NOT_GENERATED" | "PENDING_HUMAN_SELECTION" | "LOCKED";

export interface CharacterIdentity {
  /** 正式名称。外向きの正はこれだけ */
  full_name: string;
  /** 下の名前。通常の会話文でのみ単独使用を許す */
  given_name: string;
  /** 姓。ここが別の語に化けたら NAME_COLLISION */
  family_name: string;
  /** 日本語表記。日本語コンテンツを出す時の正 */
  full_name_ja: string;
  identity_status: IdentityStatus;
  reference_face_status: ReferenceFaceStatus;
  /** 状態をその値にした理由。空にしない */
  identity_status_reason: string;
  reference_face_status_reason: string;
}

// ---------------------------------------------------------------------------
// 正式Identity（人間が編集する唯一の場所）
// ---------------------------------------------------------------------------

const FULL_NAME = "Suzuho Awano";
const FULL_NAME_JA = "粟野 鈴穂";

const PARTS = FULL_NAME.split(/\s+/).filter(Boolean);

export const CHARACTER_IDENTITY: CharacterIdentity = {
  full_name: FULL_NAME,
  given_name: PARTS[0] ?? FULL_NAME,
  family_name: PARTS.length > 1 ? PARTS[PARTS.length - 1]! : "",
  full_name_ja: FULL_NAME_JA,

  // ★ここを LOCKED にしてよいのは、調査台帳（data/identity-screening.csv）の
  //   NAME_LOCK ゲートの項目に UNKNOWN も CONFLICT も無くなった時だけ。
  //   npm run identity:check が食い違いを検出して止める。
  //
  //   2026-08-23 LOCKED。根拠は NAME_LOCK ゲート4項目がすべて CLEAR になったこと:
  //     - 日本 J-PlatPat：「粟野鈴穂」「Suzuho Awano」のフルネーム一致なし
  //     - 米国 USPTO：SUZUHO AWANO / AWANO / SUZUHO いずれも該当なし
  //     - 英語Web検索：完全一致の実在人物・ブランド・AIインフルエンサーなし
  //     - 日本語Web検索：完全一致の実在人物なし
  //   人間が2026-08-23に「今後変更しない」と決定した。以後この名前は変えない。
  identity_status: "LOCKED",
  identity_status_reason:
    "2026-08-23 人間が決定。NAME_LOCK ゲート（日本商標・米国商標・英語Web・日本語Web）4項目すべて CLEAR。" +
    "以後この名前は変更しない。" +
    "★残る UNKNOWN（X/Instagram/TikTokのID空き・EUIPO）は「この名前を使ってよいか」ではなく" +
    "「アカウントを取れるか」「EU展開してよいか」の問題なので、別ゲートで管理する",

  reference_face_status: "NOT_GENERATED",
  reference_face_status_reason:
    "名前が LOCKED になったので生成に進んでよい。" +
    "候補8枚を出したら PENDING_HUMAN_SELECTION、人が1枚選んだら LOCKED にする。" +
    "基準顔は一度選ぶと全投稿がそれに縛られるため、機械が勝手に LOCKED にはしない",
};

// ---------------------------------------------------------------------------
// 運営ブランド（キャラクターIPとは完全に別物）
// ---------------------------------------------------------------------------

/**
 * ★キャラクターIP と 運営ブランド を分離する理由（恒久ルール）
 *
 *   Suzuho Awano     = キャラクターIP（出演者・Endorser）
 *   Slow Japan Guide = 運営・メディアブランド（責任主体・Publisher）
 *
 *   1. 開示のため。EU AI Act 50条・FTC の観点で「誰が運営しているか」を示す必要があるが、
 *      そこに個人名を書くと海外に本名が永久に残る。屋号なら責任主体を示しつつ本名を出さない。
 *   2. 将来キャラを増やせるようにするため。運営ブランドがキャラ名と同一だと、
 *      2人目のキャラを足した瞬間に破綻する。
 *   3. 商品ブランドと出演者を分けるため。「鈴穂」は第30類（菓子）の既存商標があるので、
 *      食品の商品ブランド名には使えない。商品ブランドは運営ブランド側で作り、
 *      キャラは "Suzuho Awano recommends ..." の出演者扱いにする。
 */
export interface OperatorBrand {
  /** 運営ブランド名。ここが外向きの「Run by ○○」になる */
  name: string;
  /** 予定ドメイン */
  domain: string;
  status: IdentityStatus;
  status_reason: string;
}

export const OPERATOR_BRAND: OperatorBrand = {
  name: "Slow Japan Guide",
  domain: "slowjapanguide.com",
  status: "LOCKED",
  status_reason:
    "2026-08-23 人間が決定。完全一致の企業・旅行サービス・AIインフルエンサー・成人向け・VPN/eSIMブランドは検出されず、" +
    "slowjapanguide.com は未登録（Verisign RDAP が404を返す＝取得可能）。" +
    "★注意: 「slow travel Japan」は楽天トラベル・JNTO等が使う一般的な説明語なので、" +
    "商標としての識別力は弱い。独占できる名前だとは考えない",
};

/** 旅行・VPN・eSIM・日本商品・語学まで包含できるので、ジャンル拡張しても名前を変えずに済む */
export const OPERATOR_BRAND_IS_PLACEHOLDER = OPERATOR_BRAND.name.startsWith("[");

/** 名前がまだ [仮] のままか。仮のうちは画像プロンプトへ名前を焼き込まない */
export const NAME_IS_PLACEHOLDER = CHARACTER_IDENTITY.full_name.startsWith("[");

/** フルネーム（姓＋名）になっているか。1語だけの名前は固有性が作れない */
export const NAME_IS_FULL_NAME = CHARACTER_IDENTITY.family_name.length > 0;

// ---------------------------------------------------------------------------
// 使用場所（Surface）
// ---------------------------------------------------------------------------

/**
 * 名前がどこに書かれるか。
 * ここを分けたのが今回の変更の中心。
 *
 * 【判断の理由 / 恒久ルール】
 *   検索固有性のためフルネームをブランドIdentityとして固定する。
 *   下の名前は業界に先客が埋め尽くしていて、単独では固有名になり得ない。
 *   しかし通常の会話文まで機械的にフルネームを強制すると、
 *   "Hi, I'm Suzuho Awano." のような不自然な英文しか書けなくなり、
 *   Xでの反応が落ちる。固有性が要るのは「外から検索・照合される面」であって、
 *   本人が喋っている本文ではない。だから場所で判定を変える。
 */
export type NameSurface =
  // --- BRAND_IDENTITY_STRICT（必ずフルネーム） ---
  | "X_DISPLAY_NAME"
  | "X_BIO_INTRO"
  | "WEBSITE_TITLE"
  | "WEBSITE_METADATA"
  | "ABOUT_PAGE"
  | "AFFILIATE_APPLICATION"
  | "ASP_PROFILE"
  | "MEDIA_KIT"
  | "STRUCTURED_DATA"
  | "OG_METADATA"
  | "CHARACTER_BIBLE"
  | "ANALYTICS_CHARACTER_NAME"
  | "AFFILIATE_CAMPAIGN_NAME"
  | "LEGAL_DISCLOSURE"
  | "IMAGE_CHARACTER_ID"
  | "AI_INTERNAL_IDENTITY"
  // --- CONTENT_NATURAL（下の名前だけでもよい） ---
  | "X_POST_BODY"
  | "X_REPLY"
  | "LP_BODY";

export type NamePolicy = "BRAND_IDENTITY_STRICT" | "CONTENT_NATURAL";

export const NAME_POLICY: Record<NameSurface, NamePolicy> = {
  X_DISPLAY_NAME: "BRAND_IDENTITY_STRICT",
  X_BIO_INTRO: "BRAND_IDENTITY_STRICT",
  WEBSITE_TITLE: "BRAND_IDENTITY_STRICT",
  WEBSITE_METADATA: "BRAND_IDENTITY_STRICT",
  ABOUT_PAGE: "BRAND_IDENTITY_STRICT",
  AFFILIATE_APPLICATION: "BRAND_IDENTITY_STRICT",
  ASP_PROFILE: "BRAND_IDENTITY_STRICT",
  MEDIA_KIT: "BRAND_IDENTITY_STRICT",
  STRUCTURED_DATA: "BRAND_IDENTITY_STRICT",
  OG_METADATA: "BRAND_IDENTITY_STRICT",
  CHARACTER_BIBLE: "BRAND_IDENTITY_STRICT",
  ANALYTICS_CHARACTER_NAME: "BRAND_IDENTITY_STRICT",
  AFFILIATE_CAMPAIGN_NAME: "BRAND_IDENTITY_STRICT",
  LEGAL_DISCLOSURE: "BRAND_IDENTITY_STRICT",
  IMAGE_CHARACTER_ID: "BRAND_IDENTITY_STRICT",
  AI_INTERNAL_IDENTITY: "BRAND_IDENTITY_STRICT",

  X_POST_BODY: "CONTENT_NATURAL",
  X_REPLY: "CONTENT_NATURAL",
  LP_BODY: "CONTENT_NATURAL",
};

export const NAME_SURFACES = Object.keys(NAME_POLICY) as NameSurface[];

export const SURFACE_LABEL: Record<NameSurface, string> = {
  X_DISPLAY_NAME: "X表示名",
  X_BIO_INTRO: "X Bioの自己紹介",
  WEBSITE_TITLE: "サイトのタイトル",
  WEBSITE_METADATA: "サイトのmetadata",
  ABOUT_PAGE: "Aboutページ",
  AFFILIATE_APPLICATION: "アフィリエイト申請",
  ASP_PROFILE: "ASPのプロフィール",
  MEDIA_KIT: "メディアキット",
  STRUCTURED_DATA: "構造化データ",
  OG_METADATA: "OGメタデータ",
  CHARACTER_BIBLE: "Character Bibleの正式名称",
  ANALYTICS_CHARACTER_NAME: "分析上のcharacter_name",
  AFFILIATE_CAMPAIGN_NAME: "アフィリのキャンペーン名",
  LEGAL_DISCLOSURE: "法務・開示まわり",
  IMAGE_CHARACTER_ID: "画像生成のCharacter ID",
  AI_INTERNAL_IDENTITY: "AI内部のIdentity",
  X_POST_BODY: "X投稿の本文",
  X_REPLY: "Xのリプライ本文",
  LP_BODY: "LPの本文",
};

/** その場所でフルネームが必須か */
export function requiresFullName(surface: NameSurface): boolean {
  return NAME_POLICY[surface] === "BRAND_IDENTITY_STRICT";
}

/** 既定の使用場所。指定が無い＝X投稿の本文として扱う（一番数が多い） */
export const DEFAULT_SURFACE: NameSurface = "X_POST_BODY";

// ---------------------------------------------------------------------------
// 「初めて本人を紹介する文脈」の判定
// ---------------------------------------------------------------------------

/**
 * 自己紹介の言い回し。
 * CONTENT_NATURAL でも、初出の自己紹介や、外部サイトへ単体で転載されうる文では
 * フルネームの方が得なので、止めはしないが警告する（WARN）。
 */
const SELF_INTRO_PATTERNS: RegExp[] = [
  /\bI(?:'m|’m| am)\s+(?:called\s+)?$/i,
  /\bmy name(?:'s|’s| is)\s+$/i,
  /\byou can call me\s+$/i,
  /\bcall me\s+$/i,
  /\bthis is\s+$/i,
  /\bhere'?s\s+$/i,
  /(?:^|\n)\s*(?:hi|hello|hey|nice to meet you)[,!\s]+(?:i(?:'m|’m| am)\s+)$/i,
];

export function isSelfIntroductionAt(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 48), index);
  return SELF_INTRO_PATTERNS.some((re) => re.test(before));
}

// ---------------------------------------------------------------------------
// 商標・既存名との衝突台帳
// ---------------------------------------------------------------------------

/**
 * 機械検索の結果。
 * ★UNKNOWN を PASS に丸めない。「検索で出てこなかった」は「存在しない」ではない。
 */
export type ScreeningStatus = "CLEAR" | "CONFLICT" | "UNKNOWN";

/**
 * ★調査項目は「何を止めるか」で3つに分ける。
 *
 * 以前はこれを required: boolean の1本で持っていたが、それだと
 * 「XのIDが空いているか未確認」というだけで名前そのものが確定できなくなり、
 * 逆に「未確認だから」と全部を1つの箱に入れた結果、
 * 本当に危険な項目（他人の商標とぶつかる）と、
 * 単に手続きが済んでいない項目（IDがまだ取れていない）が区別できなくなっていた。
 *
 * - NAME_LOCK : この名前を使ってよいか。他人の権利とぶつかると致命的なので、
 *               全部 CLEAR になるまで identity_status を LOCKED にしない。
 * - ACCOUNT   : そのIDを実際に取れるか。名前の正しさとは無関係。
 *               本番アカウント作成を止めるが、名前の確定は止めない。
 * - EXPANSION : その地域・その商材へ広げる時に初めて要る。今は止めない。
 */
export type ScreeningGate = "NAME_LOCK" | "ACCOUNT" | "EXPANSION";

export const GATE_LABEL: Record<ScreeningGate, string> = {
  NAME_LOCK: "名前を確定してよいか",
  ACCOUNT: "本番アカウントを作れるか",
  EXPANSION: "その地域・商材へ広げてよいか",
};

export interface ScreeningItem {
  id: string;
  /** どこを調べたか（人が読んで再現できる粒度で書く） */
  registry: string;
  status: ScreeningStatus;
  /** 確認日。UNKNOWN なら null */
  checkedAt: string | null;
  sourceUrl: string | null;
  note: string;
  /** この項目の UNKNOWN が何を止めるか */
  gate: ScreeningGate;
  /** そのゲートの中で必須か。任意項目の UNKNOWN では止めない */
  required: boolean;
}

/**
 * 調査先の一覧。
 * NAME_LOCK ゲートの必須項目が全部 CLEAR になるまで identity_status は PROVISIONAL のまま。
 * 実際の結果は data/identity-screening.csv に人が書き込む（機械が勝手に埋めない）。
 */
export const REQUIRED_SCREENINGS: {
  id: string;
  registry: string;
  gate: ScreeningGate;
  required: boolean;
}[] = [
  { id: "JP_TRADEMARK", registry: "日本 特許庁 J-PlatPat 商標検索", gate: "NAME_LOCK", required: true },
  { id: "US_TRADEMARK", registry: "米国 USPTO TESS 商標検索", gate: "NAME_LOCK", required: true },
  { id: "WEB_SEARCH_EN", registry: "英語での一般Web検索（同名の実在人物・ブランド）", gate: "NAME_LOCK", required: true },
  { id: "WEB_SEARCH_JA", registry: "日本語での一般Web検索（同名の実在人物・ブランド）", gate: "NAME_LOCK", required: true },

  { id: "X_HANDLE", registry: "X（旧Twitter）の同名アカウント", gate: "ACCOUNT", required: true },
  { id: "INSTAGRAM_HANDLE", registry: "Instagram の同名アカウント", gate: "ACCOUNT", required: false },
  { id: "TIKTOK_HANDLE", registry: "TikTok の同名アカウント", gate: "ACCOUNT", required: false },

  { id: "EU_TRADEMARK", registry: "EUIPO eSearch 商標検索", gate: "EXPANSION", required: false },
  { id: "DOMAIN", registry: "独自ドメインの取得可否", gate: "EXPANSION", required: false },
];

export const SCREENING_GATE: Record<string, ScreeningGate> = Object.fromEntries(
  REQUIRED_SCREENINGS.map((r) => [r.id, r.gate]),
);

export type LockDecision = {
  /** LOCKED にしてよいか */
  canLock: boolean;
  /** 台帳から機械的に導いた、あるべき状態 */
  suggested: IdentityStatus;
  conflicts: ScreeningItem[];
  unknowns: ScreeningItem[];
  missing: string[];
  reason: string;
};

/**
 * 台帳から「今 LOCKED にしてよいか」を決める。
 *
 * - CONFLICT が1つでもある → REJECTED（名前候補フェーズへ戻す）
 * - 必須項目に UNKNOWN・未記入がある → PROVISIONAL のまま
 * - 必須項目が全部 CLEAR → LOCKED にしてよい
 */
export function decideLock(items: ScreeningItem[]): LockDecision {
  const byId = new Map(items.map((i) => [i.id, i]));
  const missing = REQUIRED_SCREENINGS.filter(
    (r) => r.gate === "NAME_LOCK" && r.required && !byId.has(r.id),
  ).map((r) => r.id);

  // ★名前の確定を止めてよいのは NAME_LOCK ゲートの項目だけ。
  //   IDが空いているか（ACCOUNT）は名前の正しさと無関係なので、ここでは見ない。
  const required = items.filter((i) => i.gate === "NAME_LOCK" && i.required);
  // CONFLICT はゲートを問わず拾う。他人の権利とぶつかっているなら名前ごと考え直す。
  const conflicts = items.filter((i) => i.status === "CONFLICT" && i.gate !== "ACCOUNT");
  const unknowns = required.filter((i) => i.status === "UNKNOWN");

  if (conflicts.length > 0) {
    return {
      canLock: false,
      suggested: "REJECTED",
      conflicts,
      unknowns,
      missing,
      reason:
        `重大な衝突が${conflicts.length}件あります（${conflicts.map((c) => c.registry).join(" / ")}）。` +
        `この名前は使わず、名前候補フェーズへ戻してください`,
    };
  }
  if (missing.length > 0 || unknowns.length > 0) {
    const parts: string[] = [];
    if (missing.length) parts.push(`未記入 ${missing.length}件（${missing.join(", ")}）`);
    if (unknowns.length) parts.push(`UNKNOWN ${unknowns.length}件（${unknowns.map((u) => u.id).join(", ")}）`);
    return {
      canLock: false,
      suggested: "PROVISIONAL",
      conflicts,
      unknowns,
      missing,
      reason:
        `${parts.join(" / ")}。機械検索で確認できなかった項目を「問題なし」として扱わないため、` +
        `PROVISIONAL のまま保持します`,
    };
  }
  return {
    canLock: true,
    suggested: "LOCKED",
    conflicts,
    unknowns,
    missing,
    reason:
      `NAME_LOCK ゲートの必須${required.length}項目すべて CLEAR。LOCKED にしてよい状態です` +
      `（IDの空き・EUIPOは別ゲートなので名前の確定は止めません）`,
  };
}

/**
 * 「この名前に化けたら即アウト」の一覧。
 * 商標調査で衝突が見つかった名前もここへ足す（機械が自動で足さない。人が書く）。
 */
export const KNOWN_COLLISION_NAMES: string[] = [];

// ---------------------------------------------------------------------------
// 商品ブランド制約（★恒久ルール・削除禁止）
// ---------------------------------------------------------------------------

/**
 * ★このブロックは消さない。
 *
 * 登録6081973「鈴穂」第30類（菓子）が存続している。
 * したがって Suzuho / 鈴穂 / Suzuho Awano を
 * 「食品・菓子の商品ブランド名」として使うことはできない。
 *
 * 一方で、キャラクターが和菓子を紹介すること自体は何の問題も無い。
 * 商標が禁じるのは「その名前を商品の目印として使うこと」であって、
 * 「その名前の人物が商品を紹介すること」ではない。
 *
 * だから将来オリジナル商品を作る時は、必ず次の形にする:
 *
 *   ✕ 商品名「Suzuho 和菓子セット」        ← キャラ名が商品ブランドになっている
 *   ○ 商品名「Slow Japan Guide 和菓子セット」
 *     ＋ 紹介文 "Suzuho Awano recommends"  ← キャラは出演者(Endorser)に留まる
 *
 * 商品ブランドは運営ブランド側（Slow Japan Guide）で作り、
 * キャラクターは Endorser として登場させる。この分離は永久に維持する。
 */
export const FOOD_BRAND_RESTRICTION = {
  /** 制約の根拠 */
  registration: "登録6081973「鈴穂」第30類（菓子）",
  registry: "日本 特許庁 J-PlatPat",
  checkedAt: "2026-08-23",
  /** 商品ブランド名として使ってはいけない語 */
  forbiddenAsProductBrand: ["Suzuho", "Suzuho Awano", "鈴穂", "粟野鈴穂", "粟野 鈴穂"],
  /** この分野で禁止 */
  forbiddenCategories: ["食品", "菓子", "和菓子", "飲料", "food", "confectionery", "sweets", "snack"],
  /** 代わりにこうする */
  allowedPattern: "商品ブランド=Slow Japan Guide、キャラクター=出演者（Suzuho Awano recommends ...）",
  permanent: true,
} as const;

// ---------------------------------------------------------------------------
// 公開ゲート
// ---------------------------------------------------------------------------

export type PublishGate = {
  ok: boolean;
  blockers: string[];
  message: string;
};

/**
 * 本番公開してよい状態か。
 * ★PROVISIONAL のうちは公開しない。仮の名前で世に出ると、
 *   後から名前を変えた時に既に付いた被リンク・言及・アカウント名が全部無駄になる。
 */
export function publishGate(
  identity: CharacterIdentity = CHARACTER_IDENTITY,
  opts: { requiresFace?: boolean; screenings?: ScreeningItem[]; brand?: OperatorBrand } = {},
): PublishGate {
  const blockers: string[] = [];

  if (identity.identity_status === "REJECTED") {
    blockers.push("名前が REJECTED（重大な衝突あり）。名前候補フェーズへ戻す");
  } else if (identity.identity_status !== "LOCKED") {
    blockers.push(
      `名前が ${identity.identity_status}。商標調査が終わるまで本番公開しない（${identity.identity_status_reason}）`,
    );
  }

  // 運営ブランドが未確定だと Bio の「Run by ○○」が埋まらない＝開示が不完全になる。
  // 開示が不完全な媒体はアフィリ審査で落ちるので、公開前に必ず埋める。
  const brand = opts.brand ?? OPERATOR_BRAND;
  if (brand.status !== "LOCKED" || OPERATOR_BRAND_IS_PLACEHOLDER) {
    blockers.push(
      `運営ブランドが ${brand.status}。Bioの「Run by ○○」が埋まらないと開示が不完全になる`,
    );
  }

  // ACCOUNT ゲート: IDが取れるか確定していないと本番アカウントは作れない。
  // ★名前の確定は止めないが、ここでは止める。
  if (opts.screenings) {
    const accountUnknown = opts.screenings.filter(
      (i) => i.gate === "ACCOUNT" && i.required && i.status !== "CLEAR",
    );
    for (const item of accountUnknown) {
      blockers.push(`${item.registry} が ${item.status}。取得できるIDが決まるまで本番アカウントを作らない`);
    }
  }

  if (opts.requiresFace !== false) {
    if (identity.reference_face_status !== "LOCKED") {
      blockers.push(
        `基準顔が ${identity.reference_face_status}。8枚から人が1枚選ぶまで Reference Face を LOCKED にしない`,
      );
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    message:
      blockers.length === 0
        ? `${identity.full_name}：名前も基準顔も確定済み。本番公開の前段階まで進んでよい`
        : `本番公開不可（${blockers.length}件）: ${blockers.join(" / ")}`,
  };
}

// ---------------------------------------------------------------------------
// 表示名
// ---------------------------------------------------------------------------

/** Xなどの表示名。BRAND_IDENTITY_STRICT なので必ずフルネーム */
export function displayName(identity: CharacterIdentity = CHARACTER_IDENTITY): string {
  return `${identity.full_name} 🇯🇵 | AI Creator`;
}

/**
 * 名前確定後にやることの順番。
 * 途中を飛ばすと、古い名前のまま投稿が世に出る。
 */
export const POST_LOCK_STEPS: { step: number; label: string; done: boolean }[] = [
  { step: 1, label: "Suzuho Awano を正式Identityへ投入する", done: true },
  { step: 2, label: "identity_status を LOCKED にする", done: CHARACTER_IDENTITY.identity_status === "LOCKED" },
  { step: 3, label: `表示名を「${displayName()}」に統一する`, done: true },
  { step: 4, label: "Character Bible を更新する", done: true },
  // 第1週21投稿は本文に名前が入っていないことを確認済み（DB全25件を検査し、
  // 一致したのは無関係な単語 "hanami" のみ）。名前非依存なので再生成は不要。
  { step: 5, label: "第1週21投稿を確認する（名前非依存なら再生成不要）", done: true },
  { step: 6, label: "Compliance を全件やり直す", done: true },
  { step: 7, label: "運営ブランドを決めて OPERATOR_BRAND を LOCK する", done: OPERATOR_BRAND.status === "LOCKED" },
  { step: 8, label: "X IDの空きを人が確認して確定する（@suzuho_awano → @suzuhoawano → @awano_suzuho）", done: false },
  { step: 9, label: "基準顔候補8枚を生成する", done: CHARACTER_IDENTITY.reference_face_status !== "NOT_GENERATED" },
  { step: 10, label: "人間が8枚から1枚を選ぶ", done: CHARACTER_IDENTITY.reference_face_status === "LOCKED" },
  { step: 11, label: "Reference Face を固定する", done: CHARACTER_IDENTITY.reference_face_status === "LOCKED" },
  { step: 12, label: "X本番プロフィールを作成する", done: false },
  { step: 13, label: "X Developer App を申請する", done: false },
  { step: 14, label: "Surfshark へ申請する（1社依存にはしない）", done: false },
];
