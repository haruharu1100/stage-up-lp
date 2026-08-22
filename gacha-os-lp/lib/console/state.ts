/**
 * 契約者向け管理画面（AI GACHA OS CONSOLE）の、状態とルール。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルの位置づけ
 * ═══════════════════════════════════════════════════════
 *
 * 画面（components/console/）には、計算とルールを書きません。
 * ここに集めています。理由は lib/customerDemo.ts と同じで、
 * デザインを直すたびに「権限の判定が変わっていないか」を
 * 目で確かめる羽目になるのを避けるためです。
 *
 * ここに書いたルールは tests/ から機械で確かめます。
 *
 * ═══════════════════════════════════════════════════════
 * ★これはデモです。ただし「嘘のデモ」にはしないこと
 * ═══════════════════════════════════════════════════════
 *
 * この画面は完全な Sandbox で、本物の決済・メール・SMS・配送・本番DBには
 * 一切つながりません。データは全部この中だけで動きます。
 *
 * ただし、ルール（権限・二人承認・監査ログ・不正判定）は本物と同じにします。
 * 「デモでは承認なしで通るが、本番では止まる」という作りにしないこと。
 * 触った人が、本番の使い勝手をそのまま評価できる状態にします。
 *
 * ★逆に、本番に無いものをここで動かして見せないこと。
 *   ここで動くのに納品物に無い、が起きると、そのまま説明義務違反になります。
 *   実装状況は config/featureLedger.ts の台帳で AVAILABLE / OPTION / PLANNED を
 *   区別し、画面にもその区別を出します。
 */

import { appendAudit, type AuditEntry, type AuditAction } from "./audit";
import { assess, SIGNALS, type Assessment, type Hit, type SignalKey } from "./fraud";
import { drawOnce, seedOf, type DrawRecord } from "./draw";

/* ══════════════════════════════════════════════
   権限（RBAC）
   ══════════════════════════════════════════════ */

export type Role =
  | "VIEWER"
  | "SUPPORT"
  | "OPERATOR"
  | "FINANCE"
  | "SECURITY"
  | "SUPER_ADMIN";

export type Permission =
  | "gacha.view" | "gacha.edit" | "gacha.publish"
  | "point.view" | "point.request" | "point.approve"
  | "fraud.view" | "fraud.act"
  | "shipping.view" | "shipping.act"
  | "support.view" | "support.reply"
  | "security.view" | "audit.view"
  | "user.suspend" | "settings.edit";

/**
 * 役割ごとにできること。
 *
 * ★ポイントの「申請」と「承認」を、必ず別の権限にしてあること。
 *   1人が両方を持っていると、二人承認が形だけになります。
 *   SUPER_ADMIN だけは両方持ちますが、それでも
 *   「自分が出した申請を自分で承認する」ことは canApprove() で禁じています。
 *
 * ★承認できる人を、必ず2人以上つくること（重要）。
 *   ここを1人にすると、その人が出した申請を承認できる人がいなくなり、
 *   高額のポイント操作が永久に処理できなくなります。
 *   逆に「面倒だから」と自己承認を許すと、二人承認そのものが消えます。
 *
 *   だから、承認できる人が1人しかいない状態では、
 *   そもそも高額の申請を受け付けないようにしてあります
 *   （reducer の POINT_REQUEST を参照）。
 *   運営者には「承認できる人をもう1人つくってください」と伝えます。
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  VIEWER: ["gacha.view", "point.view", "shipping.view", "support.view"],
  SUPPORT: [
    "gacha.view", "point.view", "shipping.view", "shipping.act",
    "support.view", "support.reply",
  ],
  OPERATOR: [
    "gacha.view", "gacha.edit", "gacha.publish",
    "point.view", "shipping.view", "shipping.act",
    "support.view", "support.reply", "fraud.view",
  ],
  FINANCE: [
    "gacha.view", "point.view", "point.request",
    "shipping.view", "audit.view",
  ],
  SECURITY: [
    "gacha.view", "point.view", "fraud.view", "fraud.act",
    "security.view", "audit.view", "user.suspend",
  ],
  SUPER_ADMIN: [
    "gacha.view", "gacha.edit", "gacha.publish",
    "point.view", "point.request", "point.approve",
    "fraud.view", "fraud.act",
    "shipping.view", "shipping.act",
    "support.view", "support.reply",
    "security.view", "audit.view",
    "user.suspend", "settings.edit",
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  VIEWER: "閲覧のみ",
  SUPPORT: "サポート",
  OPERATOR: "運営",
  FINANCE: "経理",
  SECURITY: "セキュリティ",
  SUPER_ADMIN: "管理者（全権）",
};

export type Admin = {
  id: string;
  name: string;
  role: Role;
  mfaEnabled: boolean;
  lastLogin: string;
};

export function can(role: Role, p: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(p);
}

/* ══════════════════════════════════════════════
   ポイント操作と、二人承認（FOUR EYES APPROVAL）
   ══════════════════════════════════════════════ */

/**
 * この金額を超えるポイント操作は、別の管理者の承認が要る。
 * 管理画面の Settings から変えられる想定の値。
 */
export const FOUR_EYES_THRESHOLD = 100_000;

export type PointRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "APPLIED";

export type PointRequest = {
  id: string;
  userId: string;
  userName: string;
  /** 増やすなら正、減らすなら負 */
  delta: number;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  status: PointRequestStatus;
  /** 二人承認が必要か（申請時の金額で決まる。後から変えない） */
  needsApproval: boolean;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectReason?: string;
  balanceBefore: number;
  balanceAfter?: number;
};

/**
 * その申請を、この管理者が承認できるか。
 *
 * ★自分の申請を自分で承認させないこと（ここが二人承認の本体です）。
 *   権限を持っているかどうかとは別の話です。
 *   ここを外すと、全権管理者が1人で好きなだけポイントを作れます。
 */
export function canApprove(
  req: PointRequest,
  admin: Admin,
): { ok: true } | { ok: false; why: string } {
  if (req.status !== "PENDING") {
    return { ok: false, why: "この申請はすでに処理済みです。" };
  }
  if (!can(admin.role, "point.approve")) {
    return {
      ok: false,
      why: `${ROLE_LABEL[admin.role]} には承認の権限がありません。`,
    };
  }
  if (req.requestedBy === admin.id) {
    return {
      ok: false,
      why: "自分が出した申請は、自分では承認できません。別の管理者が承認してください。",
    };
  }
  return { ok: true };
}

/* ══════════════════════════════════════════════
   ガチャ・ユーザー・発送・問い合わせ
   ══════════════════════════════════════════════ */

export type GachaStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "PAUSED" | "SOLD_OUT";

export type ConsoleGacha = {
  id: string;
  title: string;
  status: GachaStatus;
  /** 1回の料金（円） */
  price: number;
  total: number;
  left: number;
  /** 設計上の還元率（%） */
  designedRtp: number;
  /** 実際に出ている還元率（%） */
  realRtp: number;
  /** 市場価格を今の相場に置き換えた場合の還元率（%） */
  marketRtp: number;
  /** 売上（円） */
  revenue: number;
  /** 粗利（円） */
  profit: number;
  publishedAt?: string;
  /** 公開前バックテストの結果。未実施なら null */
  backtest: "SAFE" | "CAUTION" | "DANGER" | null;
  /**
   * 等級ごとに、もう何本出たか。
   * 箱から札を抜く方式なので、ここが在庫の残りそのものになります。
   * 未設定は「まだ1本も出ていない」と同じ扱いです。
   */
  drawn?: Record<string, number>;
};

export type ConsoleUser = {
  id: string;
  name: string;
  joinedAt: string;
  points: number;
  spent: number;
  shipments: number;
  risk: Assessment;
  status: "ACTIVE" | "STEP_UP" | "REVIEW" | "SUSPENDED";
};

export type Signup = {
  id: string;
  at: string;
  /** 伏せ字にしたメール。実データは画面に出さない */
  emailMasked: string;
  ipMasked: string;
  risk: Assessment;
  handled: boolean;
};

export type Order = {
  id: string;
  userId: string;
  userName: string;
  prize: string;
  requestedAt: string;
  status: "UNSHIPPED" | "PREPARING" | "SHIPPED";
  carrier?: string;
  tracking?: string;
  /** 仕入れ先（景品マスターに登録された購入URL）。デモではダミー */
  buyUrl?: string;
};

export type Ticket = {
  id: string;
  userId: string;
  userName: string;
  subject: string;
  body: string;
  at: string;
  status: "AI_ANSWERED" | "HUMAN_REVIEW" | "IN_PROGRESS" | "DONE";
  /** AIが用意した下書き。送るかどうかは人が決める */
  aiDraft?: string;
  reply?: string;
  /** AIが自分で答えずに人へ回した理由 */
  escalateReason?: string;
};

/* ══════════════════════════════════════════════
   画面全体の状態
   ══════════════════════════════════════════════ */

export type ConsoleState = {
  /** ログイン中の管理者。null ならログイン画面 */
  me: Admin | null;
  /** MFAを通したか。ログインだけでは中に入れない */
  mfaPassed: boolean;
  admins: Admin[];
  gachas: ConsoleGacha[];
  users: ConsoleUser[];
  signups: Signup[];
  pointRequests: PointRequest[];
  orders: Order[];
  tickets: Ticket[];
  audit: AuditEntry[];
  /** 抽選の記録。お客様画面から引いた分が入る */
  draws: DrawRecord[];
  /** 直近の操作結果。画面上部に出す */
  flash: { kind: "ok" | "warn" | "error"; text: string } | null;
};

/**
 * お客様画面の確認で使う、デモのお客様。
 *
 * ★実在の会員を使わないこと。
 *   「お客様の目で確かめる」ために、わざと既存の会員の1人を借りています。
 *   このデモの会員は全員が架空なので、これで問題ありません。
 *   本番の管理画面では、運営者専用のテスト会員を別に作ります。
 *   本物のお客様のアカウントで試し引きをすると、その方の残高が動きます。
 */
export const PREVIEW_USER_ID = "u_8842";

/* ══════════════════════════════════════════════
   デモ用の初期データ（すべて架空）
   ══════════════════════════════════════════════ */

/**
 * ★実在の商品名・ブランド名・人名を書かないこと。
 *   「いま売っている」と誤解される可能性があり、権利の問題も出ます。
 *
 * ★数字は、オンラインガチャの実際の水準に収めること。
 *   実還元率が 90〜105% から外れた数字を出すと、
 *   「この会社は相場を知らない」と読まれます。
 */
export const DEMO_ADMINS: Admin[] = [
  { id: "ad_01", name: "運営 太郎", role: "SUPER_ADMIN", mfaEnabled: true, lastLogin: "2026-08-22 09:12" },
  { id: "ad_02", name: "経理 花子", role: "FINANCE", mfaEnabled: true, lastLogin: "2026-08-22 08:40" },
  { id: "ad_03", name: "運営 次郎", role: "OPERATOR", mfaEnabled: true, lastLogin: "2026-08-21 19:03" },
  { id: "ad_04", name: "サポート 三郎", role: "SUPPORT", mfaEnabled: false, lastLogin: "2026-08-22 10:25" },
  { id: "ad_05", name: "監視 四郎", role: "SECURITY", mfaEnabled: true, lastLogin: "2026-08-22 07:55" },
  /* ★2人目の全権管理者。二人承認を実際に成立させるために必要です。
     承認できる人が1人しかいないと、その人の申請を誰も承認できません */
  { id: "ad_06", name: "統括 五郎", role: "SUPER_ADMIN", mfaEnabled: true, lastLogin: "2026-08-21 21:40" },
];

/** ポイント変更を承認できる管理者（申請者本人を除く） */
export function approversOtherThan(s: ConsoleState, adminId: string): Admin[] {
  return s.admins.filter((x) => x.id !== adminId && can(x.role, "point.approve"));
}

const hit = (key: SignalKey, detail: string): Hit => ({
  key,
  label: SIGNALS[key].label,
  weight: SIGNALS[key].weight,
  detail,
});

export const DEMO_GACHAS: ConsoleGacha[] = [
  {
    id: "g_101", title: "プレミアムカード 500", status: "PUBLISHED",
    price: 500, total: 1000, left: 267, designedRtp: 96.5, realRtp: 98.2,
    marketRtp: 113.4, revenue: 366_500, profit: 42_100,
    publishedAt: "2026-08-18", backtest: "SAFE",
  },
  {
    id: "g_102", title: "スニーカー BOX 1000", status: "PUBLISHED",
    price: 1000, total: 500, left: 88, designedRtp: 94.8, realRtp: 96.1,
    marketRtp: 99.3, revenue: 412_000, profit: 61_800,
    publishedAt: "2026-08-15", backtest: "SAFE",
  },
  {
    id: "g_103", title: "腕時計 ハイエンド 3000", status: "PAUSED",
    price: 3000, total: 200, left: 143, designedRtp: 92.0, realRtp: 104.7,
    marketRtp: 121.8, revenue: 171_000, profit: -8_400,
    publishedAt: "2026-08-20", backtest: "CAUTION",
  },
  {
    id: "g_104", title: "週末限定 カード 300", status: "REVIEW",
    price: 300, total: 2000, left: 2000, designedRtp: 95.2, realRtp: 0,
    marketRtp: 0, revenue: 0, profit: 0, backtest: "SAFE",
  },
  {
    id: "g_105", title: "新作アクセサリー 800", status: "DRAFT",
    price: 800, total: 600, left: 600, designedRtp: 0, realRtp: 0,
    marketRtp: 0, revenue: 0, profit: 0, backtest: null,
  },
];

export const DEMO_USERS: ConsoleUser[] = [
  {
    id: "u_8842", name: "会員 8842", joinedAt: "2026-06-02",
    points: 12_500, spent: 84_300, shipments: 7,
    risk: assess([]), status: "ACTIVE",
  },
  {
    id: "u_9105", name: "会員 9105", joinedAt: "2026-08-22",
    points: 500, spent: 0, shipments: 0,
    risk: assess([
      hit("ipBurst", "同一IPから17アカウント（10分以内）"),
      hit("deviceReuse", "同じ端末から6アカウント"),
      hit("signupSpeed", "入力から送信まで 0.4秒"),
      hit("smsRetry", "SMS再送 12回"),
    ]),
    status: "REVIEW",
  },
  {
    id: "u_9107", name: "会員 9107", joinedAt: "2026-08-22",
    points: 500, spent: 0, shipments: 0,
    risk: assess([hit("anonymizer", "VPN経由の登録")]),
    status: "ACTIVE",
  },
  {
    id: "u_9110", name: "会員 9110", joinedAt: "2026-08-22",
    points: 0, spent: 0, shipments: 0,
    risk: assess([
      hit("referralRing", "同じ4人の間だけで紹介が循環"),
      hit("phoneReuse", "同じ電話番号で3アカウント"),
      hit("paymentReuse", "同一カードが9アカウントに紐づく"),
    ]),
    status: "REVIEW",
  },
  {
    id: "u_7731", name: "会員 7731", joinedAt: "2026-07-14",
    points: 3_200, spent: 26_800, shipments: 2,
    risk: assess([hit("emailPattern", "連番のメールアドレス")]),
    status: "ACTIVE",
  },
];

export const DEMO_SIGNUPS: Signup[] = [
  { id: "s_01", at: "2026-08-22 11:42", emailMasked: "ka****@ex*****.jp", ipMasked: "203.0.113.***", risk: assess([]), handled: false },
  { id: "s_02", at: "2026-08-22 11:40", emailMasked: "ta****@ex*****.jp", ipMasked: "198.51.100.***", risk: assess([hit("anonymizer", "VPN経由")]), handled: false },
  {
    id: "s_03", at: "2026-08-22 11:38", emailMasked: "ab****@ma*****.com", ipMasked: "192.0.2.***",
    risk: assess([
      hit("ipBurst", "同一IPから17アカウント（10分以内）"),
      hit("deviceReuse", "同じ端末から6アカウント"),
      hit("signupSpeed", "入力から送信まで 0.4秒"),
      hit("botBehavior", "マウス移動なし・スクロールなし"),
    ]),
    handled: false,
  },
  {
    id: "s_04", at: "2026-08-22 11:35", emailMasked: "zz****+9@ma*****.com", ipMasked: "192.0.2.***",
    risk: assess([
      hit("emailPattern", "プラス記号で同一受信箱へ集約"),
      hit("ipBurst", "同一IPから17アカウント（10分以内）"),
      hit("uaAnomaly", "自動化ツールの名乗り"),
      hit("requestBurst", "1分間に240リクエスト"),
    ]),
    handled: false,
  },
];

export const DEMO_ORDERS: Order[] = [
  { id: "o_5001", userId: "u_8842", userName: "会員 8842", prize: "S賞 相当（デモ景品A）", requestedAt: "2026-08-22 10:05", status: "UNSHIPPED", buyUrl: "#demo-purchase" },
  { id: "o_5002", userId: "u_7731", userName: "会員 7731", prize: "A賞 相当（デモ景品B）", requestedAt: "2026-08-22 09:51", status: "UNSHIPPED", buyUrl: "#demo-purchase" },
  { id: "o_5003", userId: "u_8842", userName: "会員 8842", prize: "B賞 相当（デモ景品C）", requestedAt: "2026-08-21 18:22", status: "PREPARING", buyUrl: "#demo-purchase" },
  { id: "o_5004", userId: "u_7731", userName: "会員 7731", prize: "C賞 相当（デモ景品D）", requestedAt: "2026-08-21 14:09", status: "SHIPPED", carrier: "デモ運輸", tracking: "DEMO-4821-0093" },
];

export const DEMO_TICKETS: Ticket[] = [
  {
    id: "t_301", userId: "u_8842", userName: "会員 8842",
    subject: "発送はいつになりますか", body: "先週依頼した商品の発送予定を知りたいです。",
    at: "2026-08-22 10:12", status: "AI_ANSWERED",
    reply: "ご依頼の商品は準備中です。発送時に追跡番号をお知らせします。",
  },
  {
    id: "t_302", userId: "u_7731", userName: "会員 7731",
    subject: "返金してほしい", body: "先ほど引いたガチャの結果に納得できません。返金してもらえますか。",
    at: "2026-08-22 11:20", status: "HUMAN_REVIEW",
    escalateReason: "返金の可否は規約とその場の判断が要るため、AIは回答しません。",
    aiDraft: "お問い合わせありがとうございます。抽選結果に対する返金は承っておりませんが、ご事情をうかがったうえで対応を検討いたします。差し支えなければ、詳しい状況をお聞かせください。",
  },
  {
    id: "t_303", userId: "u_9105", userName: "会員 9105",
    subject: "アカウントが登録できない", body: "登録しようとすると止まってしまいます。",
    at: "2026-08-22 11:45", status: "HUMAN_REVIEW",
    escalateReason: "不正判定に関わる内容のため、AIは回答しません。運営者が確認します。",
    aiDraft: "ご不便をおかけしております。お客様のご登録について確認しております。少々お待ちください。",
  },
];

/* ══════════════════════════════════════════════
   初期状態
   ══════════════════════════════════════════════ */

export function initialState(): ConsoleState {
  return {
    me: null,
    mfaPassed: false,
    admins: DEMO_ADMINS,
    gachas: DEMO_GACHAS.map((g) => ({ ...g })),
    users: DEMO_USERS.map((u) => ({ ...u })),
    signups: DEMO_SIGNUPS.map((s) => ({ ...s })),
    pointRequests: [],
    orders: DEMO_ORDERS.map((o) => ({ ...o })),
    tickets: DEMO_TICKETS.map((t) => ({ ...t })),
    audit: [],
    draws: [],
    flash: null,
  };
}

/* ══════════════════════════════════════════════
   操作
   ══════════════════════════════════════════════ */

export type ConsoleAction =
  | { type: "LOGIN"; adminId: string }
  | { type: "MFA_OK" }
  | { type: "LOGOUT" }
  | { type: "SWITCH_ADMIN"; adminId: string }
  | { type: "PUBLISH_GACHA"; gachaId: string }
  | { type: "PAUSE_GACHA"; gachaId: string; reason: string }
  | { type: "POINT_REQUEST"; userId: string; delta: number; reason: string }
  | { type: "POINT_APPROVE"; requestId: string }
  | { type: "POINT_REJECT"; requestId: string; reason: string }
  | { type: "FRAUD_HANDLE"; signupId: string; decision: "ALLOW" | "STEP_UP" | "REVIEW" | "DENY" }
  | { type: "SHIP"; orderId: string }
  /**
   * お客様として1回引く（お客様画面の確認から使う）。
   *
   * key は二重送信を見分けるための鍵です。
   * 同じ鍵で2回届いても、抽選は1回しか成立しません。
   */
  | { type: "DRAW"; gachaId: string; key: string }
  | { type: "SUPPORT_REPLY"; ticketId: string; text: string }
  | { type: "CLEAR_FLASH" }
  | { type: "RESET" }
  /** 監査ログの改ざん検知を実演するための操作。デモ専用 */
  | { type: "TAMPER_AUDIT"; seq: number };

/** いまの時刻。デモなので固定文字（サーバーとブラウザで食い違わせない） */
const NOW = "2026-08-22 12:00";

/** 監査ログを1件足すための短縮 */
function log(
  s: ConsoleState,
  action: AuditAction,
  target: string,
  summary: string,
  extra: { before?: string; after?: string; reason?: string } = {},
): AuditEntry[] {
  const me = s.me;
  return appendAudit(s.audit, {
    at: NOW,
    actorId: me?.id ?? "-",
    actorName: me?.name ?? "-",
    actorRole: me?.role ?? "-",
    action,
    target,
    summary,
    ...extra,
  });
}

const deny = (s: ConsoleState, text: string): ConsoleState => ({
  ...s,
  flash: { kind: "error", text },
});

export function reducer(s: ConsoleState, a: ConsoleAction): ConsoleState {
  switch (a.type) {
    case "LOGIN": {
      const me = s.admins.find((x) => x.id === a.adminId);
      if (!me) return deny(s, "その管理者は見つかりません。");
      return { ...s, me, mfaPassed: false, flash: null };
    }

    case "MFA_OK": {
      if (!s.me) return s;
      return {
        ...s,
        mfaPassed: true,
        audit: log(s, "MFA_VERIFIED", s.me.id, `${s.me.name} が2段階認証を通過`),
        flash: { kind: "ok", text: `${s.me.name}（${ROLE_LABEL[s.me.role]}）としてログインしました。` },
      };
    }

    case "LOGOUT":
      return { ...s, me: null, mfaPassed: false, flash: null };

    /**
     * 管理者を切り替える。
     * ★二人承認を実際に試せるようにするための、デモ専用の入口です。
     *   本番では、別の人が別の端末でログインします。
     */
    case "SWITCH_ADMIN": {
      const me = s.admins.find((x) => x.id === a.adminId);
      if (!me) return s;
      return {
        ...s,
        me,
        mfaPassed: true,
        flash: { kind: "ok", text: `${me.name}（${ROLE_LABEL[me.role]}）に切り替えました。` },
      };
    }

    case "PUBLISH_GACHA": {
      if (!s.me || !can(s.me.role, "gacha.publish")) {
        return deny(s, `${s.me ? ROLE_LABEL[s.me.role] : "この権限"} には公開の権限がありません。`);
      }
      const g = s.gachas.find((x) => x.id === a.gachaId);
      if (!g) return s;
      /* ★バックテストを通していないガチャは公開させないこと。
         「危ないかもしれないが、とりあえず出す」を仕組みで禁じます */
      if (g.backtest === null) {
        return deny(s, "公開前バックテストが未実施です。先に検証してください。");
      }
      if (g.backtest === "DANGER") {
        return deny(s, "バックテストが DANGER です。構成を見直してください。");
      }
      return {
        ...s,
        gachas: s.gachas.map((x) =>
          x.id === a.gachaId ? { ...x, status: "PUBLISHED", publishedAt: "2026-08-22" } : x,
        ),
        audit: log(s, "GACHA_PUBLISH", g.id, `ガチャ「${g.title}」を公開`, {
          before: g.status,
          after: "PUBLISHED",
        }),
        flash: { kind: "ok", text: `「${g.title}」を公開しました。お客様の画面に出ています。` },
      };
    }

    case "PAUSE_GACHA": {
      if (!s.me || !can(s.me.role, "gacha.publish")) {
        return deny(s, "販売停止の権限がありません。");
      }
      const g = s.gachas.find((x) => x.id === a.gachaId);
      if (!g) return s;
      return {
        ...s,
        gachas: s.gachas.map((x) => (x.id === a.gachaId ? { ...x, status: "PAUSED" } : x)),
        audit: log(s, "GACHA_PAUSE", g.id, `ガチャ「${g.title}」を販売停止`, {
          before: g.status,
          after: "PAUSED",
          reason: a.reason,
        }),
        flash: { kind: "warn", text: `「${g.title}」を販売停止しました。` },
      };
    }

    case "POINT_REQUEST": {
      if (!s.me || !can(s.me.role, "point.request")) {
        return deny(
          s,
          `${s.me ? ROLE_LABEL[s.me.role] : "この権限"} には、ポイントを変更する権限がありません。経理または管理者に依頼してください。`,
        );
      }
      if (!a.reason.trim()) {
        return deny(s, "理由の入力は必須です。理由のないポイント操作は記録できません。");
      }
      const u = s.users.find((x) => x.id === a.userId);
      if (!u) return s;

      const needsApproval = Math.abs(a.delta) >= FOUR_EYES_THRESHOLD;

      /* ★承認できる別の管理者がいないなら、申請自体を受け付けない。
         受け付けてしまうと、誰も承認できない申請が残り続けます。
         「承認待ちのまま放置されている」のは、
         止まっていることに気づきにくい、いちばん困る壊れ方です。 */
      if (needsApproval && approversOtherThan(s, s.me.id).length === 0) {
        return deny(
          s,
          `${FOUR_EYES_THRESHOLD.toLocaleString()}pt 以上の変更には、別の管理者の承認が必要です。` +
            "いまは承認できる方が他にいないため、この申請は受け付けられません。" +
            "設定画面で、承認できる管理者をもう1人ご登録ください。",
        );
      }

      const req: PointRequest = {
        id: `pr_${s.pointRequests.length + 1}`,
        userId: u.id,
        userName: u.name,
        delta: a.delta,
        reason: a.reason,
        requestedBy: s.me.id,
        requestedByName: s.me.name,
        requestedAt: NOW,
        status: "PENDING",
        needsApproval,
        balanceBefore: u.points,
      };

      /* 閾値未満なら、その場で反映する（申請＝実行） */
      if (!needsApproval) {
        const after = u.points + a.delta;
        return {
          ...s,
          users: s.users.map((x) => (x.id === u.id ? { ...x, points: after } : x)),
          pointRequests: [
            ...s.pointRequests,
            { ...req, status: "APPLIED", balanceAfter: after },
          ],
          audit: log(s, "POINT_ADJUST_APPLY", u.id,
            `${u.name} のポイントを ${a.delta > 0 ? "+" : ""}${a.delta.toLocaleString()}pt 変更`,
            { before: `${u.points.toLocaleString()}pt`, after: `${after.toLocaleString()}pt`, reason: a.reason },
          ),
          flash: { kind: "ok", text: `${u.name} のポイントを変更しました。監査ログに残しています。` },
        };
      }

      /* 閾値以上は、別の管理者の承認を待つ */
      return {
        ...s,
        pointRequests: [...s.pointRequests, req],
        audit: log(s, "POINT_ADJUST_REQUEST", u.id,
          `${u.name} へ ${a.delta > 0 ? "+" : ""}${a.delta.toLocaleString()}pt の変更を申請`,
          { before: `${u.points.toLocaleString()}pt`, after: "（承認待ち）", reason: a.reason },
        ),
        flash: {
          kind: "warn",
          text: `${FOUR_EYES_THRESHOLD.toLocaleString()}pt 以上のため、別の管理者の承認が必要です。承認されるまで反映されません。`,
        },
      };
    }

    case "POINT_APPROVE": {
      if (!s.me) return s;
      const req = s.pointRequests.find((x) => x.id === a.requestId);
      if (!req) return s;

      const check = canApprove(req, s.me);
      if (!check.ok) return deny(s, check.why);

      const u = s.users.find((x) => x.id === req.userId);
      if (!u) return s;
      const after = u.points + req.delta;

      return {
        ...s,
        users: s.users.map((x) => (x.id === u.id ? { ...x, points: after } : x)),
        pointRequests: s.pointRequests.map((x) =>
          x.id === req.id
            ? {
                ...x, status: "APPLIED", approvedBy: s.me!.id,
                approvedByName: s.me!.name, approvedAt: NOW, balanceAfter: after,
              }
            : x,
        ),
        audit: log(s, "POINT_ADJUST_APPROVE", u.id,
          `${req.requestedByName} の申請を承認し、${u.name} のポイントを変更`,
          { before: `${u.points.toLocaleString()}pt`, after: `${after.toLocaleString()}pt`, reason: req.reason },
        ),
        flash: { kind: "ok", text: `承認しました。${u.name} のポイントに反映しています。` },
      };
    }

    case "POINT_REJECT": {
      if (!s.me) return s;
      const req = s.pointRequests.find((x) => x.id === a.requestId);
      if (!req) return s;
      const check = canApprove(req, s.me);
      if (!check.ok) return deny(s, check.why);

      return {
        ...s,
        pointRequests: s.pointRequests.map((x) =>
          x.id === req.id ? { ...x, status: "REJECTED", rejectReason: a.reason } : x,
        ),
        audit: log(s, "POINT_ADJUST_REJECT", req.userId,
          `${req.requestedByName} の申請を却下`, { reason: a.reason },
        ),
        flash: { kind: "warn", text: "申請を却下しました。" },
      };
    }

    case "FRAUD_HANDLE": {
      if (!s.me || !can(s.me.role, "fraud.act")) {
        return deny(s, `${s.me ? ROLE_LABEL[s.me.role] : "この権限"} には、不正判定を処理する権限がありません。`);
      }
      const sg = s.signups.find((x) => x.id === a.signupId);
      if (!sg) return s;
      const label = {
        ALLOW: "通常登録として通した", STEP_UP: "追加認証を求めた",
        REVIEW: "保留にして確認中", DENY: "登録を止めた",
      }[a.decision];
      return {
        ...s,
        signups: s.signups.map((x) => (x.id === a.signupId ? { ...x, handled: true } : x)),
        audit: log(s, a.decision === "DENY" ? "FRAUD_BLOCK" : "FRAUD_REVIEW", sg.id,
          `登録 ${sg.emailMasked}（${sg.risk.level} / ${sg.risk.score}点）を${label}`,
          { reason: sg.risk.hits.map((h) => h.detail).join(" / ") || "手がかりなし" },
        ),
        flash: { kind: "ok", text: `${label}。判定の理由ごと監査ログに残しています。` },
      };
    }

    case "SHIP": {
      if (!s.me || !can(s.me.role, "shipping.act")) {
        return deny(s, "発送処理の権限がありません。");
      }
      const o = s.orders.find((x) => x.id === a.orderId);
      if (!o) return s;
      const tracking = `DEMO-${o.id.slice(-4)}-${String(s.orders.length * 17).padStart(4, "0")}`;
      return {
        ...s,
        orders: s.orders.map((x) =>
          x.id === a.orderId
            ? { ...x, status: "SHIPPED", carrier: "デモ運輸", tracking }
            : x,
        ),
        audit: log(s, "SHIPPING_MARK", o.id, `${o.userName} の「${o.prize}」を発送済みに変更`, {
          before: o.status, after: "SHIPPED",
        }),
        flash: { kind: "ok", text: `伝票を作り、追跡番号 ${tracking} をお客様に通知しました（デモのため実際には送信していません）。` },
      };
    }

    /**
     * お客様として1回引く。
     *
     * ═══════════════════════════════════════════════
     * ★1回の抽選で動くものを、全部まとめて動かすこと
     * ═══════════════════════════════════════════════
     *
     *   1回引くと、これだけのものが同時に動きます。
     *
     *     ・お客様のポイントが減る
     *     ・残り口数が1つ減る
     *     ・等級ごとの在庫が1本減る
     *     ・売上と粗利が動く
     *     ・実還元率が変わる
     *     ・当たった方には発送依頼ができる
     *     ・抽選の記録が1件残る
     *
     *   ★このうち1つでも欠けたら、全部やらないこと。
     *     いちばん多い事故は「ポイントだけ減って、当たりが記録されない」です。
     *     お客様から見ると、お金だけ取られて何も起きていません。
     *     本番では、これを1つのトランザクションでまとめます。
     *     ここでは1つの新しい状態としてまとめて返すことで、同じ形にしています。
     */
    case "DRAW": {
      const g = s.gachas.find((x) => x.id === a.gachaId);
      if (!g) return s;

      /* ★同じ鍵の抽選は、1回しか成立させないこと（二重送信対策）。
         通信が不安定なときや、ボタンを連打されたとき、
         同じ依頼が2回届きます。画面でボタンを押せなくするだけでは防げません。
         押せなくなる前に、もう届いているからです。 */
      const already = s.draws.find((d) => d.idempotencyKey === a.key);
      if (already) {
        return {
          ...s,
          flash: {
            kind: "warn",
            text:
              `同じ依頼をもう一度受け取りましたが、二重には引いていません。` +
              `前回の結果（${already.grade === "-" ? "はずれ" : `${already.grade}賞`}）をそのままお返ししています。`,
          },
        };
      }

      if (g.status !== "PUBLISHED") {
        return deny(s, `「${g.title}」はいま販売中ではありません。お客様の画面にも出ていません。`);
      }
      if (g.left <= 0) {
        return deny(s, `「${g.title}」は完売しました。`);
      }

      const u = s.users.find((x) => x.id === PREVIEW_USER_ID);
      if (!u) return s;
      if (u.points < g.price) {
        return deny(
          s,
          `${u.name} の残高は ${u.points.toLocaleString()}pt です。` +
            `${g.price.toLocaleString()}pt が足りません。` +
            `ポイント管理から追加すると引けます（10万pt以上は別の管理者の承認が要ります）。`,
        );
      }

      const drawn = g.drawn ?? {};
      const nth = s.draws.filter((d) => d.gachaId === g.id).length + 1;
      const out = drawOnce(
        { title: g.title, price: g.price, total: g.total, left: g.left, designedRtp: g.designedRtp },
        drawn,
        seedOf(g.id),
        nth,
      );

      /* 実還元率を計算し直す。
         いままでにお返しした金額 ＝ これまでの売上 × これまでの実還元率 */
      const paidBefore = g.revenue * (g.realRtp / 100);
      const revenueAfter = g.revenue + g.price;
      const paidAfter = paidBefore + out.value;
      const realRtpAfter = Math.round((paidAfter / revenueAfter) * 1000) / 10;

      const leftAfter = g.left - 1;
      const balanceAfter = u.points - g.price + out.points;

      const record: DrawRecord = {
        id: `dr_${s.draws.length + 1}`,
        idempotencyKey: a.key,
        at: NOW,
        userId: u.id,
        userName: u.name,
        gachaId: g.id,
        gachaTitle: g.title,
        price: g.price,
        balanceBefore: u.points,
        balanceAfter,
        grade: out.grade,
        prizeName: out.name,
        prizeValue: out.value,
        leftBefore: g.left,
        leftAfter,
        seed: seedOf(g.id),
        nth,
      };

      const orders: Order[] = out.needsShipping
        ? [
            {
              id: `o_${5000 + s.orders.length + 1}`,
              userId: u.id,
              userName: u.name,
              prize: `${out.grade}賞 ${out.name}`,
              requestedAt: NOW,
              status: "UNSHIPPED",
              buyUrl: "#demo-purchase",
            },
            ...s.orders,
          ]
        : s.orders;

      return {
        ...s,
        gachas: s.gachas.map((x) =>
          x.id !== g.id
            ? x
            : {
                ...x,
                left: leftAfter,
                status: leftAfter === 0 ? "SOLD_OUT" : x.status,
                drawn:
                  out.grade === "-"
                    ? drawn
                    : { ...drawn, [out.grade]: (drawn[out.grade] ?? 0) + 1 },
                revenue: revenueAfter,
                profit: x.profit + g.price - out.value,
                realRtp: realRtpAfter,
              },
        ),
        users: s.users.map((x) => (x.id === u.id ? { ...x, points: balanceAfter, spent: x.spent + g.price } : x)),
        orders,
        draws: [...s.draws, record],
        flash: {
          kind: out.needsShipping ? "ok" : "warn",
          text: out.needsShipping
            ? `${out.grade}賞（${out.value.toLocaleString()}円相当）が出ました。発送依頼が1件増えています。`
            : `${out.grade === "-" ? "はずれ" : `${out.grade}賞`}でした。${out.points.toLocaleString()}pt をお返ししました。`,
        },
      };
    }

    case "SUPPORT_REPLY": {
      if (!s.me || !can(s.me.role, "support.reply")) {
        return deny(s, "返信の権限がありません。");
      }
      const t = s.tickets.find((x) => x.id === a.ticketId);
      if (!t) return s;
      return {
        ...s,
        tickets: s.tickets.map((x) =>
          x.id === a.ticketId ? { ...x, status: "DONE", reply: a.text } : x,
        ),
        audit: log(s, "SUPPORT_REPLY", t.id, `${t.userName} の「${t.subject}」に返信`),
        flash: { kind: "ok", text: "返信しました。お客様の画面に届いています（デモのため実際には送信していません）。" },
      };
    }

    case "CLEAR_FLASH":
      return { ...s, flash: null };

    case "RESET": {
      const fresh = initialState();
      return {
        ...fresh,
        me: s.me,
        mfaPassed: s.mfaPassed,
        audit: log({ ...fresh, me: s.me, audit: [] }, "DEMO_RESET", "-", "デモデータを初期状態に戻した"),
        flash: { kind: "ok", text: "デモを初期状態に戻しました。何度でもやり直せます。" },
      };
    }

    /**
     * 監査ログの1件を、記録された後から書き換える。
     *
     * ★これはデモのための「攻撃側」のボタンです。
     *   本番の管理画面には、この操作を置きません。
     *   ハッシュを作り直さずに中身だけ変えるので、
     *   AUDIT VERIFY を押すと TAMPER DETECTED になります。
     *   「検証しています」が本当かどうかを、その場で確かめてもらうためのものです。
     */
    case "TAMPER_AUDIT": {
      return {
        ...s,
        audit: s.audit.map((e) =>
          e.seq === a.seq
            ? { ...e, summary: `${e.summary}（何者かに書き換えられた記録）`, after: "999,999,999pt" }
            : e,
        ),
        flash: {
          kind: "warn",
          text: "監査ログを1件だけ書き換えました。SECURITY CENTER の AUDIT VERIFY で検知できるか確かめてください。",
        },
      };
    }

    default:
      return s;
  }
}

/* ══════════════════════════════════════════════
   画面から使う計算
   ══════════════════════════════════════════════ */

/** ダッシュボードの「今日やること」 */
export type TodoItem = {
  urgency: "MUST" | "SHOULD";
  label: string;
  count: number;
  /** 押したときに飛ぶ画面 */
  to: string;
};

export function todayTodos(s: ConsoleState): TodoItem[] {
  const out: TodoItem[] = [];

  const risky = s.gachas.filter(
    (g) => g.status === "PUBLISHED" && (g.realRtp >= 105 || g.marketRtp >= 110),
  ).length;
  if (risky > 0) out.push({ urgency: "MUST", label: "相場の急騰で還元率が上がったガチャ", count: risky, to: "gacha" });

  const fraud = s.signups.filter((x) => !x.handled && (x.risk.level === "HIGH" || x.risk.level === "BLOCK")).length;
  if (fraud > 0) out.push({ urgency: "MUST", label: "確認が必要な新規登録", count: fraud, to: "fraud" });

  const human = s.tickets.filter((t) => t.status === "HUMAN_REVIEW").length;
  if (human > 0) out.push({ urgency: "MUST", label: "AIが答えず、人へ回った問い合わせ", count: human, to: "support" });

  const approve = s.pointRequests.filter((r) => r.status === "PENDING").length;
  if (approve > 0) out.push({ urgency: "MUST", label: "承認待ちのポイント変更", count: approve, to: "points" });

  const unship = s.orders.filter((o) => o.status !== "SHIPPED").length;
  if (unship > 0) out.push({ urgency: "SHOULD", label: "未発送", count: unship, to: "shipping" });

  const stepUp = s.signups.filter((x) => !x.handled && x.risk.level === "MEDIUM").length;
  if (stepUp > 0) out.push({ urgency: "SHOULD", label: "追加認証を求めた登録", count: stepUp, to: "fraud" });

  return out;
}

/** ダッシュボードの数字 */
export function summary(s: ConsoleState) {
  const published = s.gachas.filter((g) => g.status === "PUBLISHED");
  return {
    revenueToday: 128_400,
    revenueMonth: published.reduce((a, g) => a + g.revenue, 0),
    playsToday: 412,
    users: 2_847,
    publishedCount: published.length,
    rtpAlerts: published.filter((g) => g.realRtp >= 105 || g.marketRtp >= 110).length,
    unshipped: s.orders.filter((o) => o.status !== "SHIPPED").length,
    tickets: s.tickets.filter((t) => t.status === "HUMAN_REVIEW").length,
    fraudReview: s.signups.filter((x) => !x.handled && x.risk.level !== "LOW").length,
  };
}

/** FRAUD CENTER の集計。項目11の表示に使う */
export function fraudCounts(s: ConsoleState) {
  const all = [...s.signups];
  return {
    total: 1_284,
    normal: 1_241,
    stepUp: 31,
    review: 10,
    block: 2,
    /** デモで実際に手を動かせる分 */
    pending: all.filter((x) => !x.handled),
  };
}
