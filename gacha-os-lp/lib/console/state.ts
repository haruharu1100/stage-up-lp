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
import { buildSpec } from "./spec";
import { aiAnswer } from "./support";
import { backtestReport, designedRtp, type GachaSpec } from "@/lib/backtest";

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
   * 賞の構成そのもの。AI GACHA BUILDER から登録したガチャに入ります。
   *
   * ★検証は、この構成をそのまま回すこと。
   *   ここが無いガチャ（デモの初期データ）は、還元率から組み直した
   *   近似の構成で検証します。そのことは画面にも書きます。
   *   「何を検証したか分からない SAFE」を作らないためです。
   */
  spec?: GachaSpec;
  /**
   * 等級ごとに、もう何本出たか。
   * 箱から札を抜く方式なので、ここが在庫の残りそのものになります。
   * 未設定は「まだ1本も出ていない」と同じ扱いです。
   */
  drawn?: Record<string, number>;
};

/** お届け先。デモなので、実在しない住所を入れてあります */
export type Address = {
  name: string;
  zip: string;
  addr: string;
  tel: string;
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
  /** 登録済みのお届け先。発送を選んだときに、この内容を確認していただきます */
  address?: Address;
};

/* ══════════════════════════════════════════════
   獲得商品（当たった景品）
   ══════════════════════════════════════════════ */

/**
 * 当たった景品が、いまどうなっているか。
 *
 *   UNCHOSEN       … まだ「発送」か「ポイント交換」かを選んでいない
 *   SHIP_REQUESTED … 発送を選んだ（発送依頼が1件立っている）
 *   EXCHANGED      … ポイントに交換した（残高が増えている）
 *
 * ★この3つは、行ったり戻ったりしないこと。
 *   UNCHOSEN から片方へ進んだら、そこで確定です。
 *   「交換したけどやっぱり現物がほしい」を許すと、
 *   ポイントを使い切った後に現物も受け取れることになり、
 *   1つの景品で二重に払うことになります。
 */
export type PrizeStatus = "UNCHOSEN" | "SHIP_REQUESTED" | "EXCHANGED";

export const PRIZE_STATUS_LABEL: Record<PrizeStatus, string> = {
  UNCHOSEN: "受け取り方法をお選びください",
  SHIP_REQUESTED: "発送依頼済み",
  EXCHANGED: "ポイント交換済み",
};

/**
 * 獲得商品（1点）。
 *
 * ★当たった瞬間に発送依頼を立てないこと。
 *   以前はここが無く、当選＝発送依頼でした。
 *   実際のオンラインガチャでは、当たった景品を
 *   「現物で受け取る」か「ポイントに換える」かはお客様が選びます。
 *   勝手に発送してしまうと、要らない現物が届き、
 *   ポイントに換えたかった方から必ず苦情になります。
 */
export type Prize = {
  id: string;
  userId: string;
  userName: string;
  gachaId: string;
  gachaTitle: string;
  /** 等級（S / A / B …） */
  grade: string;
  /** 景品の名前 */
  name: string;
  /** 景品の価値（円） */
  value: number;
  /** ポイントに交換した場合にお返しする額（pt） */
  exchangePt: number;
  wonAt: string;
  status: PrizeStatus;
  /** 発送を選んだときに立った発送依頼のID */
  orderId?: string;
  /** ポイントに交換した時刻 */
  exchangedAt?: string;
  /** どの1回の抽選で当たったか */
  drawId?: string;
  /**
   * この商品について成立した操作の鍵。
   *
   * ★同じ鍵の依頼が2回届いても、2回は処理しないこと。
   *   連打・再読み込み・通信のやり直しで、実際に2回届きます。
   */
  opKey?: string;
};

/* ══════════════════════════════════════════════
   ポイント履歴（POINT LEDGER）
   ══════════════════════════════════════════════ */

/**
 * ポイントが動いた理由。
 *
 * ★「調整」だけで済ませないこと。
 *   後から「なぜ19,000ptなのか」を聞かれたとき、
 *   全部が「調整」だと、誰にも答えられません。
 */
export type PointEntryKind =
  | "OPENING"
  | "CHARGE"
  | "DRAW_SPEND"
  | "DRAW_RETURN"
  | "PRIZE_EXCHANGE"
  | "ADMIN_ADJUST"
  | "CAMPAIGN";

export const POINT_KIND_LABEL: Record<PointEntryKind, string> = {
  OPENING: "開始時の残高",
  CHARGE: "入金",
  DRAW_SPEND: "ガチャ利用",
  DRAW_RETURN: "抽選結果のお返し",
  PRIZE_EXCHANGE: "獲得商品をポイントに交換",
  ADMIN_ADJUST: "運営による調整",
  CAMPAIGN: "キャンペーン付与",
};

/**
 * ポイントが動いた記録を、1件ずつ残したもの。
 *
 * ★残高そのものではなく、動きを積み上げて残高になること。
 *   残高だけを持って上書きしていくと、
 *   ずれたときに、どこでずれたのかが永久に分かりません。
 *   ここでは動きを全部残し、合計が残高と一致することを
 *   テストで機械的に確かめています（pointsReconcile）。
 */
export type PointEntry = {
  id: string;
  at: string;
  userId: string;
  kind: PointEntryKind;
  /** 増えるなら正、減るなら負 */
  delta: number;
  /** この記録を反映した後の残高 */
  balanceAfter: number;
  memo: string;
  /** 抽選ID・獲得商品ID・申請IDなど */
  ref?: string;
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

/**
 * 発送の進み具合。
 *
 * ★お客様に「準備中」としか出さないこと。
 *   どこまで進んでいるのかが分からないと、
 *   同じ方から3日おきに同じ問い合わせが来ます。
 *   1つ進むたびに名前が変わるようにしてあります。
 */
export type OrderStatus =
  | "UNSHIPPED"
  | "PREPARING"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED";

/**
 * まだ運営が手を動かす必要がある状態。
 *
 * ═══════════════════════════════════════════════
 * ★これを「SHIPPED ではないもの」と書き直さないこと
 * ═══════════════════════════════════════════════
 *
 *   配送中も配達完了も、「SHIPPED ではない」です。
 *   だから o.status !== "SHIPPED" と書くと、
 *   とっくにお客様の手元へ届いた依頼まで
 *   「未発送」として数えてしまいます。
 *
 *   数えてしまうと、何が起きるか。
 *   ダッシュボードの「未発送 6件」が、いつまでも0になりません。
 *   運営は毎朝それを見て、発送画面を開いて、
 *   そこには何も無い、という空振りを毎日繰り返します。
 *   数日で「あの数字は当てにならない」と学習し、
 *   本当に未発送が溜まった日も、誰も気づかなくなります。
 *
 *   だから「やることがある状態」を、ここで1回だけ名指しで決めて、
 *   数える場所すべてが、この1つを見ます。
 */
export const ORDER_TODO: OrderStatus[] = ["UNSHIPPED", "PREPARING"];

export type Order = {
  id: string;
  userId: string;
  userName: string;
  prize: string;
  requestedAt: string;
  status: OrderStatus;
  carrier?: string;
  tracking?: string;
  /** 仕入れ先（景品マスターに登録された購入URL）。デモではダミー */
  buyUrl?: string;
  /** どの獲得商品に対する発送依頼か */
  prizeId?: string;
  /** お届け先。お客様が発送を選んだときに確認した内容 */
  address?: Address;
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
  /**
   * その返信を書いたのが、AIなのか人なのか。
   *
   * ★お客様の画面には、必ずどちらかを出すこと。
   *   人が確認したうえでの回答なのか、AIが記録から答えただけなのかで、
   *   受け取る側の重みが変わります。区別せずに出さないこと。
   */
  replyBy?: "AI" | "HUMAN";
  /** AIが自分で答えずに人へ回した理由 */
  escalateReason?: string;
  /** 二重登録を防ぐ鍵（同じ鍵の問い合わせは1件しか作らない） */
  opKey?: string;
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
  /**
   * 当たった景品（獲得商品）。
   *
   * ★ユーザー側の画面と管理サイトで、別々のダミーを持たないこと。
   *   両方ともこの1つを見ます。片方だけ更新される作りにすると、
   *   「お客様の画面では発送依頼済みなのに、管理画面には来ていない」が起きます。
   *   それは、デモでは気づけても本番では必ず事故になります。
   */
  prizes: Prize[];
  /** ポイントが動いた記録。合計が users[].points と一致すること */
  ledger: PointEntry[];
  /**
   * 直近の操作結果。画面上部に出す。
   *
   * ★to は「その文章が、どちら側に向けて書かれたものか」です。
   *
   *   運営向けの文には、担当者の名前と役割が入ります。
   *   例：「運営 太郎（管理者（全権））としてログインしました。」
   *   これがお客様の画面に出てしまうと、
   *   お客様に運営の内部事情を見せることになります。
   *   本番なら、そのまま個人情報の漏れです。
   *   （実際に、切り替えた先のお客様画面に出ているのを撮影して気づきました）
   *
   *   だから、どちら側の操作で出た文なのかを必ず持たせます。
   *   お客様の画面には to === "customer" のものだけを出します。
   *   運営の画面は両方出します。お客様が何をしたかは、運営が知ってよいことです。
   *
   *   ★to が付いていないときは、お客様には出しません。
   *     「分からないものは、お客様に見せない」側に倒します。
   *     逆にしてはいけません。付け忘れが、そのまま漏れになります。
   */
  flash: { kind: "ok" | "warn" | "error"; text: string; to?: FlashTo } | null;
};

/** その知らせが、どちら側に向けて書かれたものか */
export type FlashTo = "admin" | "customer";

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

/**
 * デモのお届け先。
 *
 * ★実在の住所・電話番号を書かないこと。
 *   郵便番号 000-0000 と 000-0000-0000 は、実在しない値です。
 *   本物らしく見せるために実在の住所を借りると、
 *   スクリーンショットが出回った時点で、その住所の方に迷惑がかかります。
 */
export const DEMO_ADDRESS: Address = {
  name: "会員 8842 様",
  zip: "000-0000",
  addr: "デモ県デモ市デモ町1-2-3 デモマンション101（架空の住所です）",
  tel: "000-0000-0000",
};

export const DEMO_USERS: ConsoleUser[] = [
  {
    id: "u_8842", name: "会員 8842", joinedAt: "2026-06-02",
    points: 12_500, spent: 84_300, shipments: 7,
    risk: assess([]), status: "ACTIVE",
    address: DEMO_ADDRESS,
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
  { id: "o_5001", userId: "u_8842", userName: "会員 8842", prize: "S賞 相当（デモ景品A）", requestedAt: "2026-08-22 10:05", status: "UNSHIPPED", buyUrl: "#demo-purchase", prizeId: "pz_04", address: DEMO_ADDRESS },
  { id: "o_5002", userId: "u_7731", userName: "会員 7731", prize: "A賞 相当（デモ景品B）", requestedAt: "2026-08-22 09:51", status: "UNSHIPPED", buyUrl: "#demo-purchase" },
  { id: "o_5003", userId: "u_8842", userName: "会員 8842", prize: "B賞 相当（デモ景品C）", requestedAt: "2026-08-21 18:22", status: "PREPARING", buyUrl: "#demo-purchase", prizeId: "pz_05", address: DEMO_ADDRESS },
  { id: "o_5004", userId: "u_7731", userName: "会員 7731", prize: "C賞 相当（デモ景品D）", requestedAt: "2026-08-21 14:09", status: "SHIPPED", carrier: "デモ運輸", tracking: "DEMO-4821-0093" },
  { id: "o_5005", userId: "u_8842", userName: "会員 8842", prize: "A賞 相当（デモ景品E）", requestedAt: "2026-08-19 16:40", status: "IN_TRANSIT", carrier: "デモ運輸", tracking: "DEMO-4819-0071", prizeId: "pz_06", address: DEMO_ADDRESS },
  { id: "o_5006", userId: "u_8842", userName: "会員 8842", prize: "B賞 相当（デモ景品F）", requestedAt: "2026-08-15 11:02", status: "DELIVERED", carrier: "デモ運輸", tracking: "DEMO-4815-0044", prizeId: "pz_07", address: DEMO_ADDRESS },
];

/**
 * 獲得商品のサンプル。
 *
 * ★全部を作り込まないこと。
 *   実際にお客様が何十点も持っている状態を全部並べても、
 *   触って確かめられるのは最初の数点だけです。
 *   ここでは「3つの状態が全部そろっていること」を優先し、
 *   受け取り方法を選べるものを3点、選び終わったものを4点だけ置いています。
 */
export const DEMO_PRIZES: Prize[] = [
  /* ── まだ選んでいない（ここから発送 or ポイント交換ができる） ── */
  { id: "pz_01", userId: "u_8842", userName: "会員 8842", gachaId: "g_101", gachaTitle: "トレカ プレミアム 500", grade: "S", name: "S賞 相当（デモ景品G）", value: 25_000, exchangePt: 25_000, wonAt: "2026-08-22 09:41", status: "UNCHOSEN" },
  { id: "pz_02", userId: "u_8842", userName: "会員 8842", gachaId: "g_101", gachaTitle: "トレカ プレミアム 500", grade: "A", name: "A賞 相当（デモ景品H）", value: 6_500, exchangePt: 6_500, wonAt: "2026-08-22 09:38", status: "UNCHOSEN" },
  { id: "pz_03", userId: "u_8842", userName: "会員 8842", gachaId: "g_102", gachaTitle: "スニーカー 1000", grade: "B", name: "B賞 相当（デモ景品I）", value: 2_400, exchangePt: 2_400, wonAt: "2026-08-21 20:15", status: "UNCHOSEN" },

  /* ── 発送を選んだもの ── */
  { id: "pz_04", userId: "u_8842", userName: "会員 8842", gachaId: "g_101", gachaTitle: "トレカ プレミアム 500", grade: "S", name: "S賞 相当（デモ景品A）", value: 25_000, exchangePt: 25_000, wonAt: "2026-08-22 10:03", status: "SHIP_REQUESTED", orderId: "o_5001" },
  { id: "pz_05", userId: "u_8842", userName: "会員 8842", gachaId: "g_102", gachaTitle: "スニーカー 1000", grade: "B", name: "B賞 相当（デモ景品C）", value: 2_400, exchangePt: 2_400, wonAt: "2026-08-21 18:20", status: "SHIP_REQUESTED", orderId: "o_5003" },
  { id: "pz_06", userId: "u_8842", userName: "会員 8842", gachaId: "g_102", gachaTitle: "スニーカー 1000", grade: "A", name: "A賞 相当（デモ景品E）", value: 6_500, exchangePt: 6_500, wonAt: "2026-08-19 16:38", status: "SHIP_REQUESTED", orderId: "o_5005" },
  { id: "pz_07", userId: "u_8842", userName: "会員 8842", gachaId: "g_101", gachaTitle: "トレカ プレミアム 500", grade: "B", name: "B賞 相当（デモ景品F）", value: 2_400, exchangePt: 2_400, wonAt: "2026-08-15 11:00", status: "SHIP_REQUESTED", orderId: "o_5006" },

  /* ── ポイントに交換したもの（もう発送はできない） ── */
  { id: "pz_08", userId: "u_8842", userName: "会員 8842", gachaId: "g_101", gachaTitle: "トレカ プレミアム 500", grade: "B", name: "B賞 相当（デモ景品J）", value: 2_400, exchangePt: 2_400, wonAt: "2026-08-14 21:07", status: "EXCHANGED", exchangedAt: "2026-08-14 21:09" },
];

/**
 * ポイント履歴のサンプル。
 *
 * ★合計が、必ず users[].points と一致すること。
 *   会員 8842 の残高は 12,500pt なので、
 *   下の delta を全部足すと 12,500 になります。
 *   ここがずれたまま画面に出すと、
 *   「履歴を見ても残高の説明がつかない」状態になります。
 *   テスト（pointsReconcile）で機械的に確かめています。
 */
export const DEMO_LEDGER: PointEntry[] = [
  { id: "pl_01", at: "2026-06-02 10:00", userId: "u_8842", kind: "OPENING", delta: 0, balanceAfter: 0, memo: "会員登録" },
  { id: "pl_02", at: "2026-08-14 20:55", userId: "u_8842", kind: "CHARGE", delta: 20_000, balanceAfter: 20_000, memo: "入金（デモ）" },
  { id: "pl_03", at: "2026-08-14 21:02", userId: "u_8842", kind: "DRAW_SPEND", delta: -500, balanceAfter: 19_500, memo: "トレカ プレミアム 500 を1回" },
  { id: "pl_04", at: "2026-08-14 21:09", userId: "u_8842", kind: "PRIZE_EXCHANGE", delta: 2_400, balanceAfter: 21_900, memo: "B賞 相当（デモ景品J）をポイントに交換", ref: "pz_08" },
  { id: "pl_05", at: "2026-08-15 10:58", userId: "u_8842", kind: "DRAW_SPEND", delta: -500, balanceAfter: 21_400, memo: "トレカ プレミアム 500 を1回" },
  { id: "pl_06", at: "2026-08-19 16:36", userId: "u_8842", kind: "DRAW_SPEND", delta: -1_000, balanceAfter: 20_400, memo: "スニーカー 1000 を1回" },
  { id: "pl_07", at: "2026-08-21 18:18", userId: "u_8842", kind: "DRAW_SPEND", delta: -1_000, balanceAfter: 19_400, memo: "スニーカー 1000 を1回" },
  { id: "pl_08", at: "2026-08-21 20:13", userId: "u_8842", kind: "DRAW_SPEND", delta: -1_000, balanceAfter: 18_400, memo: "スニーカー 1000 を1回" },
  { id: "pl_09", at: "2026-08-22 09:36", userId: "u_8842", kind: "DRAW_SPEND", delta: -500, balanceAfter: 17_900, memo: "トレカ プレミアム 500 を1回" },
  { id: "pl_10", at: "2026-08-22 09:39", userId: "u_8842", kind: "DRAW_SPEND", delta: -500, balanceAfter: 17_400, memo: "トレカ プレミアム 500 を1回" },
  { id: "pl_11", at: "2026-08-22 10:01", userId: "u_8842", kind: "DRAW_SPEND", delta: -500, balanceAfter: 16_900, memo: "トレカ プレミアム 500 を1回" },
  { id: "pl_12", at: "2026-08-22 10:04", userId: "u_8842", kind: "DRAW_RETURN", delta: 50, balanceAfter: 16_950, memo: "はずれ（参加ポイント）" },
  { id: "pl_13", at: "2026-08-22 10:20", userId: "u_8842", kind: "ADMIN_ADJUST", delta: -4_450, balanceAfter: 12_500, memo: "誤付与分の取り消し（運営による調整）" },
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
    prizes: DEMO_PRIZES.map((p) => ({ ...p })),
    ledger: DEMO_LEDGER.map((e) => ({ ...e })),
    flash: null,
  };
}

/* ══════════════════════════════════════════════
   ポイントの整合性
   ══════════════════════════════════════════════ */

/** 台帳から計算した、その会員の残高 */
export function ledgerBalance(s: ConsoleState, userId: string): number {
  return s.ledger
    .filter((e) => e.userId === userId)
    .reduce((acc, e) => acc + e.delta, 0);
}

/**
 * 会員ごとに「残高」と「台帳の合計」が合っているかを調べる。
 *
 * ★合わない状態を、画面で黙って隠さないこと。
 *   合わないということは、どこかで残高だけを動かして
 *   記録を残していないということです。
 *   それは、後から誰も説明できないお金です。
 *   だから画面にも出し、テストでも落とします。
 */
export function pointsReconcile(
  s: ConsoleState,
): { userId: string; name: string; wallet: number; ledger: number; ok: boolean }[] {
  return s.users
    .filter((u) => s.ledger.some((e) => e.userId === u.id))
    .map((u) => {
      const led = ledgerBalance(s, u.id);
      return {
        userId: u.id,
        name: u.name,
        wallet: u.points,
        ledger: led,
        ok: led === u.points,
      };
    });
}

/**
 * ポイント履歴を1件足す（残高は、直前の残高から積み上げる）。
 *
 * ★状態そのものではなく「台帳の配列」を受け取ること。
 *   1回の操作で2件以上積むことがあるからです。
 *   （例：1回引くと「利用 −500pt」と「お返し +50pt」の2件が同時に出ます）
 *   状態を受け取る形にすると、2件目が1件目を見ないまま計算してしまい、
 *   balanceAfter がずれます。
 */
function addLedger(
  ledger: PointEntry[],
  e: { userId: string; kind: PointEntryKind; delta: number; memo: string; ref?: string },
): PointEntry[] {
  const before = ledger
    .filter((x) => x.userId === e.userId)
    .reduce((acc, x) => acc + x.delta, 0);
  return [
    ...ledger,
    {
      id: `pl_${String(ledger.length + 1).padStart(2, "0")}`,
      at: NOW,
      userId: e.userId,
      kind: e.kind,
      delta: e.delta,
      balanceAfter: before + e.delta,
      memo: e.memo,
      ref: e.ref,
    },
  ];
}

/* ══════════════════════════════════════════════
   操作
   ══════════════════════════════════════════════ */

export type ConsoleAction =
  | { type: "LOGIN"; adminId: string }
  | { type: "MFA_OK" }
  | { type: "LOGOUT" }
  | { type: "SWITCH_ADMIN"; adminId: string }
  /**
   * AI GACHA BUILDER で組んだ案を、下書きとして登録する。
   *
   * ★登録した時点では backtest を null のままにすること。
   *   AIが出した案でも、検証を飛ばして公開できてはいけません。
   */
  | { type: "CREATE_GACHA"; title: string; spec: GachaSpec }
  /**
   * 公開前バックテストを実行し、結果をガチャに書き戻す。
   *
   * ★ここを通さないと公開できません（PUBLISH_GACHA が backtest を見ています）。
   *   「検証したことにする」だけの操作は用意しません。必ずエンジンを回します。
   */
  | { type: "RUN_BACKTEST"; gachaId: string }
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
  /**
   * 当たった景品を「現物で受け取る」。
   *
   * ★key は二重処理を防ぐ鍵です。DRAW と同じ考え方です。
   *   連打・再読み込み・通信のやり直しで、同じ依頼が2回届きます。
   * ★address は、その場で確認していただいた内容をそのまま持たせます。
   *   後から会員情報を変えられても、この依頼が
   *   「どこ宛てに出されたものか」は動かないようにするためです。
   */
  | { type: "PRIZE_SHIP_REQUEST"; prizeId: string; key: string; address: Address }
  /**
   * 当たった景品を「ポイントに換える」。
   *
   * ★これは金銭相当の処理です。
   *   押した瞬間に残高が増えます。だから
   *   ①同じ商品で2回できないこと ②発送を選んだ商品ではできないこと
   *   ③交換前後の残高ごと監査ログに残ること、を必ず守ります。
   */
  | { type: "PRIZE_EXCHANGE"; prizeId: string; key: string }
  /** お客様が問い合わせを送る。AIが答えるか、人に回すかはここで決まる */
  | { type: "USER_ASK"; text: string; key: string }
  | { type: "SUPPORT_REPLY"; ticketId: string; text: string }
  | { type: "CLEAR_FLASH" }
  | { type: "RESET" }
  /** 監査ログの改ざん検知を実演するための操作。デモ専用 */
  | { type: "TAMPER_AUDIT"; seq: number };

/** いまの時刻。デモなので固定文字（サーバーとブラウザで食い違わせない） */
const NOW = "2026-08-22 12:00";

/**
 * 検証に使う種（seed）。
 *
 * ★固定すること。押すたびに結果が変わる検証は、
 *   都合のよい判定が出るまで押されます。
 */
export const BACKTEST_SEED = 20260822;

/**
 * そのガチャの賞の構成を取り出す。
 *
 * BUILDER から登録したガチャは、組んだ構成をそのまま持っています。
 * デモの初期データにはそれが無いので、還元率から組み直した近似で代用します。
 * 近似かどうかは approx で返し、画面に明記します。
 */
export function specOf(g: ConsoleGacha): { spec: GachaSpec; approx: boolean } {
  if (g.spec) return { spec: g.spec, approx: false };
  return {
    spec: buildSpec(g.title, g.price, g.total, 1, g.designedRtp || 95),
    approx: true,
  };
}

/** 監査ログを1件足すための短縮 */
function log(
  s: ConsoleState,
  action: AuditAction,
  target: string,
  summary: string,
  extra: {
    before?: string;
    after?: string;
    reason?: string;
    /**
     * 操作したのが管理者ではなく、お客様である場合。
     *
     * ★お客様の操作も、同じ1本の鎖に残すこと。
     *   ポイント交換は、運営がポイントを発行したのと同じだけお金が動きます。
     *   「お客様がやったこと」を別の場所に分けて置くと、
     *   後から時系列で追えなくなり、突き合わせに何時間もかかります。
     */
    actor?: { id: string; name: string; role: string };
  } = {},
): AuditEntry[] {
  const { actor, ...rest } = extra;
  const me = s.me;
  return appendAudit(s.audit, {
    at: NOW,
    actorId: actor?.id ?? me?.id ?? "-",
    actorName: actor?.name ?? me?.name ?? "-",
    actorRole: actor?.role ?? me?.role ?? "-",
    action,
    target,
    summary,
    ...rest,
  });
}

/** お客様の操作を監査ログに残すときの「誰が」 */
const asCustomer = (u: ConsoleUser) => ({
  id: u.id,
  name: u.name,
  role: "お客様",
});

const deny = (s: ConsoleState, text: string): ConsoleState => ({
  ...s,
  flash: { kind: "error", text },
});

/**
 * お客様が自分で行う操作。
 *
 * ★ここに載せる基準は「お客様の画面から押せるか」だけです。
 *   運営がお客様の代わりに行う操作（ポイントの調整など）は入りません。
 *   あれは運営の操作なので、文面も運営に向けて書かれています。
 */
/* ★ここの型を string にしないこと。
   操作の名前を打ち間違えても気づけなくなります。
   ConsoleAction["type"] にしておけば、存在しない名前は書けません */
const CUSTOMER_ACTIONS: ReadonlySet<ConsoleAction["type"]> = new Set<
  ConsoleAction["type"]
>([
  "DRAW",
  "PRIZE_SHIP_REQUEST",
  "PRIZE_EXCHANGE",
  "USER_ASK",
]);

/**
 * 知らせに「どちら側の操作で出たか」を付ける。
 *
 * ★印を付ける場所を1か所にすること。
 *   知らせを作っている場所は、この中に30か所近くあります。
 *   そこへ1つずつ手で書き足すと、必ず書き忘れが出ます。
 *   書き忘れた1か所が、お客様に運営の名前を見せます。
 *   だから、出口でまとめて押します。ここを通らない知らせはありません。
 */
export function reducer(s: ConsoleState, a: ConsoleAction): ConsoleState {
  const next = core(s, a);
  if (!next.flash || next.flash === s.flash) return next;
  return {
    ...next,
    flash: { ...next.flash, to: CUSTOMER_ACTIONS.has(a.type) ? "customer" : "admin" },
  };
}

function core(s: ConsoleState, a: ConsoleAction): ConsoleState {
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

    /**
     * BUILDER で組んだ案を、下書きとして登録する。
     *
     * ★登録した時点では backtest を null にすること。
     *   AIが組んだ案でも、検証を飛ばして公開できてはいけません。
     *   ここで SAFE を入れてしまうと、PUBLISH_GACHA の関門が
     *   その場で無意味になります。
     */
    case "CREATE_GACHA": {
      if (!s.me || !can(s.me.role, "gacha.edit")) {
        return deny(s, `${s.me ? ROLE_LABEL[s.me.role] : "この権限"} にはガチャを作る権限がありません。`);
      }
      const title = a.title.trim();
      if (!title) return deny(s, "ガチャの名前を入れてください。");
      if (a.spec.price <= 0 || a.spec.total <= 0) {
        return deny(s, "料金と口数を入れてください。");
      }
      if (s.gachas.some((x) => x.title === title)) {
        return deny(s, `「${title}」はすでにあります。別の名前にしてください。`);
      }

      /* ★還元率は、目標値ではなく「組み上がった構成」から出すこと。
         100円単位に丸めた時点で、目標とは必ずずれます */
      const rtp = designedRtp(a.spec);
      const id = `g_${201 + s.gachas.length}`;
      const g: ConsoleGacha = {
        id,
        title,
        status: "DRAFT",
        price: a.spec.price,
        total: a.spec.total,
        left: a.spec.total,
        designedRtp: Math.round(rtp * 10) / 10,
        realRtp: 0,
        marketRtp: 0,
        revenue: 0,
        profit: 0,
        backtest: null,
        spec: { ...a.spec, name: title },
      };
      return {
        ...s,
        gachas: [...s.gachas, g],
        audit: log(s, "GACHA_CREATE", id, `ガチャ「${title}」を下書きとして登録`, {
          after: `${a.spec.price.toLocaleString()}円 × ${a.spec.total.toLocaleString()}口 ／ 設計還元率 ${g.designedRtp.toFixed(1)}%`,
        }),
        flash: {
          kind: "ok",
          text: `「${title}」を下書きに登録しました。まだ公開できません。先に公開前バックテストを実行してください。`,
        },
      };
    }

    /**
     * 公開前バックテストを実行し、結果をガチャに書き戻す。
     *
     * ★実際にエンジンを回すこと。
     *   「検証したことにする」だけの操作は用意しません。
     * ★入力が足りていないとき（usable が false）は、判定を書かないこと。
     *   景品を1本も登録していないガチャは、計算上は売上が丸ごと粗利になるので
     *   数字としては SAFE に見えます。それは安全なのではなく、
     *   入力が終わっていないだけです。
     */
    case "RUN_BACKTEST": {
      if (!s.me || !can(s.me.role, "gacha.edit")) {
        return deny(s, `${s.me ? ROLE_LABEL[s.me.role] : "この権限"} には検証を実行する権限がありません。`);
      }
      const g = s.gachas.find((x) => x.id === a.gachaId);
      if (!g) return deny(s, "そのガチャは見つかりません。");

      const { spec, approx } = specOf(g);
      const report = backtestReport(spec, BACKTEST_SEED, NOW);

      if (!report.usable) {
        /* ★ここで backtest を書き換えないこと。
           判定できないものを「判定済み」にすると、公開の関門をすり抜けます */
        return {
          ...s,
          audit: log(s, "BACKTEST_RUN", g.id, `ガチャ「${g.title}」を検証（判定できず）`, {
            before: g.backtest ?? "未実施",
            after: "判定不能",
            reason: report.issues.map((i) => i.message).join(" / "),
          }),
          flash: {
            kind: "warn",
            text: `「${g.title}」は入力が足りないため判定できません。${report.issues[0]?.message ?? ""}`,
          },
        };
      }

      const verdict = report.overall;
      const rtp = Math.round(report.designedRtp * 10) / 10;
      const line =
        report.stopLineUpPct === null
          ? "停止ラインは計算できません（設計還元率が100%以上）"
          : `相場が +${report.stopLineUpPct.toFixed(1)}% を超えたら赤字`;

      return {
        ...s,
        gachas: s.gachas.map((x) =>
          x.id === g.id ? { ...x, backtest: verdict, designedRtp: rtp } : x,
        ),
        audit: log(s, "BACKTEST_RUN", g.id, `ガチャ「${g.title}」の公開前バックテストを実行`, {
          before: g.backtest ?? "未実施",
          after: `【設計】${verdict} ／【運営】${report.stress} ／ 設計還元率 ${rtp.toFixed(1)}% ／ ${line}${approx ? "（近似の構成で検証）" : ""}`,
        }),
        flash:
          verdict === "DANGER"
            ? {
                kind: "error",
                text: `「${g.title}」は【設計】DANGER です。この構成のままでは公開できません。`,
              }
            : verdict === "CAUTION"
              ? {
                  kind: "warn",
                  text: `「${g.title}」は【設計】CAUTION です。公開はできますが、実還元率モニタを毎日見てください。`,
                }
              : {
                  kind: "ok",
                  text: `「${g.title}」は【設計】SAFE です。${line}。`,
                },
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
          /* 運営がポイントを動かしたときも、必ずお客様の履歴に出すこと。
             履歴に出ない増減があると、お客様から見て残高の説明がつきません */
          ledger: addLedger(s.ledger, {
            userId: u.id,
            kind: "ADMIN_ADJUST",
            delta: a.delta,
            memo: `運営による調整：${a.reason}`,
          }),
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
        ledger: addLedger(s.ledger, {
          userId: u.id,
          kind: "ADMIN_ADJUST",
          delta: req.delta,
          memo: `運営による調整：${req.reason}`,
        }),
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

      /* ★当たっても、この時点では発送しないこと。
         現物が要る等級（S・A・B）は「獲得商品」に入るだけです。
         発送するか、ポイントに交換するかは、お客様が後から選びます。
         ここで勝手に発送依頼を作ると、
         ポイント交換を選んだお客様の分まで倉庫が動いてしまいます。 */
      const prizes: Prize[] = out.needsShipping
        ? [
            {
              id: `pz_${String(s.prizes.length + 1).padStart(2, "0")}`,
              userId: u.id,
              userName: u.name,
              gachaId: g.id,
              gachaTitle: g.title,
              grade: out.grade,
              name: out.name,
              value: out.value,
              /* 交換ポイントは景品の価値と同じ（1円 = 1pt）。
                 デモなので割引はしていません。実物では等級ごとに率を変えられます */
              exchangePt: out.value,
              wonAt: NOW,
              status: "UNCHOSEN",
              drawId: record.id,
            },
            ...s.prizes,
          ]
        : s.prizes;

      /* ポイントの動きは、必ず台帳に残すこと。
         残高だけ書き換えると、後から「なぜこの残高なのか」を誰も説明できません */
      let ledger = addLedger(s.ledger, {
        userId: u.id,
        kind: "DRAW_SPEND",
        delta: -g.price,
        memo: `${g.title} を1回`,
        ref: record.id,
      });
      if (out.points > 0) {
        ledger = addLedger(ledger, {
          userId: u.id,
          kind: "DRAW_RETURN",
          delta: out.points,
          memo: out.grade === "-" ? "はずれ（参加ポイント）" : `${out.grade}賞（ポイントでお返し）`,
          ref: record.id,
        });
      }

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
        prizes,
        ledger,
        draws: [...s.draws, record],
        flash: {
          kind: out.needsShipping ? "ok" : "warn",
          text: out.needsShipping
            ? `${out.grade}賞（${out.value.toLocaleString()}円相当）が出ました。` +
              `獲得商品に入っています。発送するか、ポイントに交換するかをお選びください。`
            : `${out.grade === "-" ? "はずれ" : `${out.grade}賞`}でした。${out.points.toLocaleString()}pt をお返ししました。`,
        },
      };
    }

    /**
     * お客様が、当たった商品を「発送する」を選んだ。
     *
     * ═══════════════════════════════════════════════
     * ★1つの商品は、一生に一度しか処理できないこと
     * ═══════════════════════════════════════════════
     *
     *   発送依頼を出したら、その商品はもうポイントに交換できません。
     *   ポイントに交換したら、その商品はもう発送できません。
     *   どちらも「現物を1つ渡す」か「ポイントを1つ発行する」かなので、
     *   両方できてしまうと、同じ景品で二重に受け取れてしまいます。
     *
     *   だから守り方を2つ重ねています。
     *
     *     1) 状態で守る … UNCHOSEN でなければ、何もしない
     *     2) 鍵で守る   … 同じ opKey の依頼は、2回目以降を成立させない
     *
     *   1) だけでは足りません。ボタンを2回押したとき、
     *   1回目の結果が返る前に2回目が届くことがあるからです。
     *   画面でボタンを消すだけでは防げません。
     *   ★この判定は必ず「受け取った側」で行うこと。画面の側では守れません。
     */
    case "PRIZE_SHIP_REQUEST": {
      /* 同じ鍵で、もう処理が済んでいないか（二重送信・再読み込み・通信の再送） */
      const done = s.prizes.find((p) => p.opKey === a.key);
      if (done) {
        return {
          ...s,
          flash: {
            kind: "warn",
            text:
              "同じ依頼をもう一度受け取りましたが、二重には処理していません。" +
              `「${done.name}」は発送依頼済みのままです。`,
          },
        };
      }

      const p = s.prizes.find((x) => x.id === a.prizeId);
      if (!p) return deny(s, "その商品が見つかりません。");
      if (p.status === "EXCHANGED") {
        return deny(
          s,
          `「${p.name}」は ${p.exchangedAt ?? ""} にポイントへ交換済みのため、発送はできません。`,
        );
      }
      if (p.status === "SHIP_REQUESTED") {
        return deny(s, `「${p.name}」はすでに発送依頼済みです。二重には受け付けません。`);
      }

      const u = s.users.find((x) => x.id === p.userId);
      if (!u) return s;

      const order: Order = {
        id: `o_${5000 + s.orders.length + 1}`,
        userId: p.userId,
        userName: p.userName,
        prize: `${p.grade}賞 ${p.name}`,
        requestedAt: NOW,
        status: "UNSHIPPED",
        prizeId: p.id,
        /* ★住所は、依頼した時点のものを写して持つこと。
           会員情報の住所を後から書き換えても、
           すでに出した伝票の宛先は変わってはいけません */
        address: { ...a.address },
        buyUrl: "#demo-purchase",
      };

      return {
        ...s,
        orders: [order, ...s.orders],
        prizes: s.prizes.map((x) =>
          x.id === p.id
            ? { ...x, status: "SHIP_REQUESTED", orderId: order.id, opKey: a.key }
            : x,
        ),
        users: s.users.map((x) =>
          x.id === u.id ? { ...x, address: { ...a.address } } : x,
        ),
        audit: log(
          s,
          "PRIZE_SHIP_REQUEST",
          p.id,
          `${p.userName} が「${p.name}」の発送を依頼（伝票 ${order.id}）`,
          {
            before: PRIZE_STATUS_LABEL[p.status],
            after: PRIZE_STATUS_LABEL.SHIP_REQUESTED,
            reason: `お届け先 ${a.address.zip} / ${a.address.name}（鍵 ${a.key}）`,
            actor: asCustomer(u),
          },
        ),
        flash: {
          kind: "ok",
          text:
            `「${p.name}」の発送を承りました。管理サイトの未発送が1件増えています。` +
            "（デモのため、実際の配送は行いません）",
        },
      };
    }

    /**
     * お客様が、当たった商品を「ポイントに交換する」を選んだ。
     *
     * ★これは、お金が動くのと同じ処理です。
     *   交換した瞬間に残高が増えます。運営から見れば、
     *   ポイントを1件発行したのと変わりません。
     *   だから抽選と同じ厳しさで、
     *   二重処理の防止・台帳への記帳・監査ログを全部そろえます。
     *
     * ★監査ログに残すもの（後から1件で説明できること）
     *   誰が / どの商品を / 交換前の状態 / 交換後の状態 /
     *   何pt / 交換前の残高 / 交換後の残高 / 二重処理防止の鍵 / いつ
     */
    case "PRIZE_EXCHANGE": {
      const done = s.prizes.find((p) => p.opKey === a.key);
      if (done) {
        return {
          ...s,
          flash: {
            kind: "warn",
            text:
              "同じ依頼をもう一度受け取りましたが、二重には交換していません。" +
              `「${done.name}」は1回だけ交換されています。`,
          },
        };
      }

      const p = s.prizes.find((x) => x.id === a.prizeId);
      if (!p) return deny(s, "その商品が見つかりません。");
      if (p.status === "SHIP_REQUESTED") {
        return deny(
          s,
          `「${p.name}」はすでに発送依頼済みのため、ポイントには交換できません。` +
            "取り消しをご希望の場合は、お問い合わせからご連絡ください。",
        );
      }
      if (p.status === "EXCHANGED") {
        return deny(s, `「${p.name}」はすでにポイントへ交換済みです。二重には交換しません。`);
      }

      const u = s.users.find((x) => x.id === p.userId);
      if (!u) return s;

      const balanceBefore = u.points;
      const balanceAfter = balanceBefore + p.exchangePt;

      return {
        ...s,
        users: s.users.map((x) => (x.id === u.id ? { ...x, points: balanceAfter } : x)),
        prizes: s.prizes.map((x) =>
          x.id === p.id
            ? { ...x, status: "EXCHANGED", exchangedAt: NOW, opKey: a.key }
            : x,
        ),
        ledger: addLedger(s.ledger, {
          userId: u.id,
          kind: "PRIZE_EXCHANGE",
          delta: p.exchangePt,
          memo: `${p.name} をポイントに交換`,
          ref: p.id,
        }),
        audit: log(
          s,
          "PRIZE_EXCHANGE",
          p.id,
          `${p.userName} が「${p.name}」を ${p.exchangePt.toLocaleString()}pt に交換`,
          {
            before: `${PRIZE_STATUS_LABEL[p.status]} / 残高 ${balanceBefore.toLocaleString()}pt`,
            after: `${PRIZE_STATUS_LABEL.EXCHANGED} / 残高 ${balanceAfter.toLocaleString()}pt`,
            reason: `交換 ${p.exchangePt.toLocaleString()}pt（鍵 ${a.key}）`,
            actor: asCustomer(u),
          },
        ),
        flash: {
          kind: "ok",
          text:
            `${p.exchangePt.toLocaleString()}pt をお渡ししました。` +
            `残高は ${balanceAfter.toLocaleString()}pt です。` +
            `「${p.name}」は交換済みのため、発送はできません。`,
        },
      };
    }

    /**
     * お客様が問い合わせを送った。AIがその場で答えるか、人に回す。
     *
     * ★AIが答えられるのは、記録を読めば答えが1つに決まることだけです。
     *   判断が要るものは、下書きだけ作って人に回します。
     *   下書きのまま自動で送ることはありません（lib/console/support.ts）。
     */
    case "USER_ASK": {
      const already = s.tickets.find((t) => t.opKey === a.key);
      if (already) {
        return {
          ...s,
          flash: {
            kind: "warn",
            text: "同じお問い合わせをもう一度受け取りましたが、二重には登録していません。",
          },
        };
      }

      const u = s.users.find((x) => x.id === PREVIEW_USER_ID);
      if (!u) return s;

      const ans = aiAnswer(a.text, {
        userName: u.name,
        balance: u.points,
        orders: s.orders.filter((o) => o.userId === u.id),
        prizes: s.prizes.filter((p) => p.userId === u.id),
        ledger: s.ledger.filter((e) => e.userId === u.id),
      });

      const subject = a.text.trim().slice(0, 24) || "お問い合わせ";
      const base = {
        id: `t_${s.tickets.length + 1}`,
        userId: u.id,
        userName: u.name,
        subject,
        body: a.text.trim(),
        at: NOW,
        opKey: a.key,
      };

      const ticket: Ticket =
        ans.kind === "ANSWERED"
          ? { ...base, status: "AI_ANSWERED", reply: ans.text, replyBy: "AI" }
          : {
              ...base,
              status: "HUMAN_REVIEW",
              escalateReason: ans.reason,
              aiDraft: ans.draft,
            };

      return {
        ...s,
        tickets: [ticket, ...s.tickets],
        audit: log(
          s,
          "USER_ASK",
          ticket.id,
          `${u.name} からお問い合わせ「${subject}」`,
          {
            after: ans.kind === "ANSWERED" ? "AIが回答" : "人へ引き継ぎ",
            reason: ans.kind === "ANSWERED" ? "記録から答えが決まる内容" : ans.reason,
            actor: asCustomer(u),
          },
        ),
        flash:
          ans.kind === "ANSWERED"
            ? { kind: "ok", text: "AIがその場でお答えしました。" }
            : {
                kind: "warn",
                text:
                  "この内容はAIが判断せず、運営者へ引き継ぎました。" +
                  "管理サイトの問い合わせ画面に「要確認」として届いています。",
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
          x.id === a.ticketId
            ? { ...x, status: "DONE", reply: a.text, replyBy: "HUMAN" }
            : x,
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

  const unship = s.orders.filter((o) => ORDER_TODO.includes(o.status)).length;
  if (unship > 0) out.push({ urgency: "SHOULD", label: "未発送", count: unship, to: "shipping" });

  /* ★お客様が受け取り方法を選ぶのを待っている商品は、
     運営の「やること」ではありません。ここには入れません。
     入れてしまうと、運営が何もできない件数が毎日残り続け、
     やることの一覧そのものが信用されなくなります */

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
    unshipped: s.orders.filter((o) => ORDER_TODO.includes(o.status)).length,
    tickets: s.tickets.filter((t) => t.status === "HUMAN_REVIEW").length,
    fraudReview: s.signups.filter((x) => !x.handled && x.risk.level !== "LOW").length,
    /* お客様が、まだ受け取り方法を選んでいない商品 */
    unchosenPrizes: s.prizes.filter((p) => p.status === "UNCHOSEN").length,
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
