/**
 * 問い合わせ（運営側）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面が、いちばん事故を起こしやすい理由
 * ═══════════════════════════════════════════════════════
 *
 *   ほかの画面は「数字が違う」で済みます。
 *   ここは、間違えると**お客様に文章が届きます**。
 *   届いた文章は、取り消せません。
 *
 *   だから、ここには他の画面より重い決まりを置きます。
 *
 *       ① AIは、下書きしか作らない。送るのは必ず人
 *       ② AIが答えてはいけない話は、答えずに人へ回す（理由つき）
 *       ③ 誰が言ったのか（お客様・AI・担当者）を必ず残す
 *       ④ 送ったあとに黙って書き換えられない
 *       ⑤ AIが答えただけで「解決済み」にしない
 *
 * ═══════════════════════════════════════════════════════
 * ★②を、AIの賢さで守ろうとしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「返金の話にはAIが答えないよう、うまく指示する」——
 *   これは守りではありません。指示は、いつか外れます。
 *   外れた1回が、返金の約束になります。
 *
 *   ですので、AIに聞く前に、こちらで先に決めます。
 *   決めるのは escalationReason()（下）です。
 *   ここに引っかかったものは、AIの答えを**作りません**。
 *   作らなければ、間違って送ることもできません。
 *
 * ═══════════════════════════════════════════════════════
 * ★他社のデータを混ぜないこと（30項目の6番）
 * ═══════════════════════════════════════════════════════
 *
 *   AIが下書きを作るとき、注文や発送や残高を読みます。
 *   その読み取りは、必ず
 *
 *       WHERE tenant_id = ? AND user_id = ?
 *
 *   の両方で絞ります。片方だけにすると、
 *   同じ番号の別会社のお客様の情報が混ざります。
 *   混ざったことは、送ったあとまで誰も気づきません。
 */

import type { Transaction } from "@libsql/client";

import { can, type Role } from "@/lib/permissions";
import { appendAuditTx } from "./audit";
import { db, withWriteTx } from "./db";
import { id } from "./ids";
import { notifyTx } from "./notify";
import {
  TICKET_LABEL_ADMIN,
  canMoveTicket,
  isOpenTicket,
  isTicketStatus,
  type TicketStatus,
} from "./ticketStatus";

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
const strOrNull = (v: unknown) =>
  v === null || v === undefined ? null : String(v);

/** 理由・返信として短すぎる文字数。ほかの画面と同じ基準にそろえる */
export const MIN_REASON = 4;
export const MIN_REPLY = 4;
export const MAX_REPLY = 4000;

/* ══════════════════════════════════════════════
   間違いの伝え方
   ══════════════════════════════════════════════ */

export type TicketAdminCode =
  | "NOT_FOUND"
  | "NO_REASON"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "BAD_STATUS"
  | "SAME_VALUE"
  | "ALREADY_AI_REPLIED"
  | "NEEDS_HUMAN"
  | "NO_ASSIGNEE"
  | "CONFLICT";

export class TicketAdminError extends Error {
  constructor(
    readonly code: TicketAdminCode,
    message: string,
  ) {
    super(message);
    this.name = "TicketAdminError";
  }
}

/* ══════════════════════════════════════════════
   優先度と分類
   ══════════════════════════════════════════════ */

/**
 * 優先度。
 *
 * ★4段階に増やさないこと。
 *   増やすと、運営の方が「中の上」を選び始めます。
 *   選べる幅が広いほど、並べ替えの意味は薄くなります。
 */
export const TICKET_PRIORITIES = ["HIGH", "NORMAL", "LOW"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export function isTicketPriority(v: unknown): v is TicketPriority {
  return (
    typeof v === "string" &&
    (TICKET_PRIORITIES as readonly string[]).includes(v)
  );
}

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  HIGH: "高",
  NORMAL: "ふつう",
  LOW: "低",
};

/**
 * 分類。
 *
 * ★「その他」を最初に作らないこと。
 *   作ると、9割が「その他」になります。
 *   分からないものは、分類を空のままにします。
 *   空欄は「まだ見ていない」という、正しい情報です。
 */
export const TICKET_CATEGORIES = [
  "SHIPPING",
  "POINT",
  "PRIZE",
  "ACCOUNT",
  "GACHA",
  "REFUND",
  "TROUBLE",
  "OTHER",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  SHIPPING: "発送・お届け",
  POINT: "ポイント",
  PRIZE: "獲得した景品",
  ACCOUNT: "アカウント",
  GACHA: "ガチャの内容",
  REFUND: "返金・キャンセル",
  TROUBLE: "不具合・苦情",
  OTHER: "その他",
};

export function categoryLabelOf(v: string | null): string | null {
  if (!v) return null;
  return (CATEGORY_LABEL as Record<string, string>)[v] ?? v;
}

/* ══════════════════════════════════════════════
   AIに答えさせてはいけないもの（30項目の7番）
   ══════════════════════════════════════════════ */

/**
 * この言葉が入っていたら、AIには答えさせない。
 *
 * ★「たぶん大丈夫そうだから通す」を作らないこと。
 *   ここは、疑わしいものを全部人へ回す側に倒します。
 *   人へ回しすぎて困るのは、運営の手間だけです。
 *   AIが答えすぎて困るのは、お客様と、会社の信用です。
 *   釣り合っていません。
 *
 * ★ここを短くしたくなったら、まず実際の問い合わせを数えること。
 *   「多すぎる」と感じたときの多すぎるは、たいてい思い込みです。
 */
const NG: { reason: string; words: string[] }[] = [
  {
    reason: "返金・キャンセルのお話です。金額の約束は、人が判断します。",
    words: ["返金", "返品", "キャンセル", "取り消し", "取消", "解約", "払い戻"],
  },
  {
    reason: "高額なポイントの補償のお話です。人が確かめてから返します。",
    words: ["補償", "賠償", "弁償", "保証して", "埋め合わせ"],
  },
  {
    reason: "商品の破損・不足のお話です。現物の確認が要ります。",
    /*
     * ★「届いてい」を、この一覧に入れないこと（2026-08-27に外しました）。
     *
     *   「まだ届いていません」は、いちばん多い、ふつうのご質問です。
     *   ここに入れていたあいだ、発送のご質問がすべて人の確認へ回り、
     *   追跡番号を調べて下書きを出す仕組みが、一度も動きませんでした。
     *
     *   中身が足りない・無くなった、というお申し出は、
     *   下の「入ってい」「足りな」「紛失」で拾います。
     *   単に「まだ届かない」だけなら、追跡番号を添えた下書きを
     *   担当者に渡すほうが、人手も待ち時間も短くなります。
     *   （下書きは、人が送信を押すまでお客様には出ません）
     */
    words: [
      "壊れ", "割れ", "破損", "折れ", "傷", "汚れ",
      "入ってい", "足りな", "紛失", "無くなっ", "なくなっ", "抜けて",
    ],
  },
  {
    reason: "真贋（本物かどうか）のお話です。AIには判断させません。",
    words: ["偽物", "偽造", "本物", "真贋", "コピー品", "パチモン"],
  },
  {
    reason: "法的な主張が含まれています。必ず人が読んで対応します。",
    words: [
      "弁護士", "訴え", "訴訟", "裁判", "消費者庁", "消費生活センター",
      "景表法", "特商法", "違法", "詐欺", "通報", "警察",
    ],
  },
  {
    reason: "アカウントの停止・削除のお話です。人が確かめてから行います。",
    words: ["退会", "アカウント削除", "垢消", "凍結", "停止して", "ban", "BAN"],
  },
  {
    reason: "個人情報のお取り扱いのお話です。人が対応します。",
    words: ["個人情報", "住所を教え", "電話番号を教え", "開示", "削除請求"],
  },
  {
    reason: "抽選の確率についての強いご指摘です。人が確かめて返します。",
    words: ["確率がおかしい", "確率操作", "出ない", "当たらない", "不正", "いかさま", "イカサマ", "やらせ"],
  },
  {
    reason: "強くお怒りです。最初の一言を、AIに任せません。",
    words: ["ふざけ", "最悪", "詐欺", "許さ", "responsable", "責任", "炎上", "晒す", "拡散"],
  },
];

/**
 * AIに答えさせてよいか。
 *
 * @returns 人へ回す理由。null なら、AIが答えてよい。
 */
export function escalationReason(subject: string, body: string): string | null {
  const t = `${subject}\n${body}`;
  for (const g of NG) {
    for (const w of g.words) {
      if (t.includes(w)) return g.reason;
    }
  }
  /* ★高額が出てきたら、内容に関わらず人へ回す。
       金額の話は、言葉づかいだけでは見分けられません */
  const kingaku = t.match(/([0-9０-９,，]{4,})\s*(円|pt|ポイント)/);
  if (kingaku) {
    const n = Number(kingaku[1].replace(/[,，]/g, "").replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    ));
    if (Number.isFinite(n) && n >= 10_000) {
      return `${n.toLocaleString()}${kingaku[2]} という大きな金額のお話です。人が確かめます。`;
    }
  }
  return null;
}

/**
 * 分類の見立て。
 *
 * ★当てられないものを、無理に埋めないこと。
 *   分からなければ null を返します。
 */
export function guessCategory(subject: string, body: string): TicketCategory | null {
  const t = `${subject}\n${body}`;
  const hit: [TicketCategory, string[]][] = [
    ["REFUND", ["返金", "返品", "キャンセル", "解約", "払い戻"]],
    ["TROUBLE", ["壊れ", "破損", "傷", "不具合", "エラー", "動かな", "苦情"]],
    ["SHIPPING", ["発送", "配送", "届", "追跡", "伝票", "住所", "宅配"]],
    ["POINT", ["ポイント", "pt", "残高", "チャージ", "課金"]],
    ["PRIZE", ["景品", "当たった", "当選", "交換"]],
    ["ACCOUNT", ["ログイン", "パスワード", "登録", "退会", "メールアドレス"]],
    ["GACHA", ["ガチャ", "確率", "排出", "オリパ"]],
  ];
  for (const [cat, words] of hit) {
    for (const w of words) if (t.includes(w)) return cat;
  }
  return null;
}

/* ══════════════════════════════════════════════
   返すもの
   ══════════════════════════════════════════════ */

/** 一覧の1行（30項目の2番） */
export type TicketRow = {
  id: string;
  /** 人が読める会員番号 */
  displayId: string;
  userId: string;
  userName: string;
  /** ★一覧では伏せ字。住所は出さない（30項目の14番） */
  emailMasked: string | null;
  subject: string;
  category: string | null;
  categoryLabel: string | null;
  status: TicketStatus;
  statusLabel: string;
  priority: TicketPriority;
  priorityLabel: string;
  /** AIが一次回答を出したか */
  aiReplied: boolean;
  /** 人の確認が要るか */
  needsHuman: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  /** やり取りの件数。1なら、まだ誰も返していない */
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TicketCounts = {
  all: number;
  /** まだ誰かが待っているもの */
  open: number;
  new: number;
  aiReplied: number;
  humanReview: number;
  inProgress: number;
  resolved: number;
  high: number;
  unassigned: number;
};

/**
 * ぜんぶ0。
 *
 * ★見る権限が無い人へ返すときに使います。
 *   ここを null にしないこと。画面が
 *   「0件（片づいている）」と「読めなかった」を
 *   区別できなくなります。読めなかったことは、
 *   入口（API）が 403 ではっきり伝えます。
 */
const ZERO_COUNTS: TicketCounts = {
  all: 0,
  open: 0,
  new: 0,
  aiReplied: 0,
  humanReview: 0,
  inProgress: 0,
  resolved: 0,
  high: 0,
  unassigned: 0,
};

/** やり取りの1行（30項目の5番） */
export type TicketMessage = {
  id: string;
  seq: number;
  authorKind: "CUSTOMER" | "AI" | "STAFF";
  authorLabel: string;
  authorName: string;
  body: string;
  /** AIが何を見て書いたか。★お客様には見せない */
  sources: string[] | null;
  createdAt: string;
  /** 送ったあとに直したか */
  edited: boolean;
  editedAt: string | null;
  editedBy: string | null;
  originalBody: string | null;
};

export type TicketDetail = {
  id: string;
  displayId: string;
  userId: string;
  userName: string;
  /** ★完全なメールは、開いた1件だけ */
  email: string | null;
  customerStatus: string;
  subject: string;
  category: string | null;
  categoryLabel: string | null;
  status: TicketStatus;
  statusLabel: string;
  priority: TicketPriority;
  priorityLabel: string;
  aiReplied: boolean;
  aiRepliedAt: string | null;
  needsHuman: boolean;
  /** なぜAIが答えなかったか。★空にしないこと */
  escalateReason: string | null;
  /** AIの下書き。まだ送っていない */
  aiDraft: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
};

const AUTHOR_LABEL: Record<TicketMessage["authorKind"], string> = {
  CUSTOMER: "お客様",
  AI: "AI（下書きを人が送信）",
  STAFF: "担当者",
};

/* ══════════════════════════════════════════════
   読み取り
   ══════════════════════════════════════════════ */

export type TicketListFilter = {
  /** Ticket ID / 会員ID / 名前 / メール / 件名（30項目の3番） */
  q?: string;
  /** 状態で絞る */
  status?: string;
  /** 高優先度だけ */
  onlyHigh?: boolean;
  /** 未担当だけ */
  onlyUnassigned?: boolean;
  /** 担当者で絞る */
  assigneeId?: string;
  /** まだ終わっていないものだけ */
  onlyOpen?: boolean;
};

export type TicketListResult = {
  rows: TicketRow[];
  total: number;
  counts: TicketCounts;
  canReply: boolean;
};

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const head = email.slice(0, at);
  const domain = email.slice(at);
  const keep = head.slice(0, Math.min(2, head.length));
  return `${keep}${"*".repeat(Math.max(1, head.length - keep.length))}${domain}`;
}

function statusOf(v: unknown): TicketStatus {
  const s = str(v);
  /* ★知らない状態を「未対応」に丸めないこと。
       丸めると、移行し忘れた行が普通の未対応に紛れます。
       ここでは、知らないものは HUMAN_REVIEW（人が見る）へ寄せます。
       人の目に触れる側へ倒すのが、安全側です */
  return isTicketStatus(s) ? s : "HUMAN_REVIEW";
}

function priorityOf(v: unknown): TicketPriority {
  const s = str(v);
  return isTicketPriority(s) ? s : "NORMAL";
}

/**
 * 一覧。
 *
 * ★本文（body）を返さないこと。
 *   一覧は「どれを開くか決めるため」だけにあります。
 *   本文を混ぜると、20件で100行になり、
 *   目的の1件を探すのに関係のない本文を読まされます。
 */
export async function ticketList(
  tenantId: string,
  role: Role | null,
  filter: TicketListFilter = {},
): Promise<TicketListResult> {
  /**
   * ★見る権限を、ここで必ず確かめること。
   *
   *   2026-08-27 まで、ここは「返信できるか」しか見ていませんでした。
   *   そのため、問い合わせを見る権限が無い役（経理など）でも、
   *   一覧だけは全部読めていました。
   *   問い合わせの件名には、注文番号・苦情の内容・
   *   ときには体調や家庭の事情まで書かれます。
   *
   *   入口（app/api/console/tickets）でも同じ確認をしていますが、
   *   ここでも確かめます。入口を1本足した日に、
   *   確認を書き忘れても漏れないようにするためです。
   *
   *   ★空を返すときも、件数は0で返すこと。
   *     null にすると、画面が「読めなかった」と区別できません。
   */
  const canView = role !== null && can(role, "support.view");
  const canReply = role !== null && can(role, "support.reply");

  if (!canView) {
    return {
      rows: [],
      total: 0,
      counts: { ...ZERO_COUNTS },
      canReply: false,
    };
  }

  const r = await db().execute({
    sql: `SELECT t.id, t.user_id, t.subject, t.category, t.status, t.priority,
                 t.needs_human, t.assignee_id, t.assignee_name,
                 t.ai_replied_at, t.created_at, t.updated_at,
                 c.display_id, c.name AS user_name, c.email,
                 (SELECT COUNT(*) FROM ticket_messages m
                   WHERE m.tenant_id = t.tenant_id AND m.ticket_id = t.id) AS msg_count
            FROM support_tickets t
            LEFT JOIN customers c
                   ON c.tenant_id = t.tenant_id AND c.id = t.user_id
           WHERE t.tenant_id = ?
           ORDER BY t.updated_at DESC, t.created_at DESC, t.id DESC`,
    args: [tenantId],
  });

  let rows: TicketRow[] = (r.rows as Row[]).map((x) => {
    const st = statusOf(x.status);
    const pr = priorityOf(x.priority);
    const cat = strOrNull(x.category);
    return {
      id: str(x.id),
      displayId: str(x.display_id),
      userId: str(x.user_id),
      userName: str(x.user_name),
      emailMasked: maskEmail(strOrNull(x.email)),
      subject: str(x.subject),
      category: cat,
      categoryLabel: categoryLabelOf(cat),
      status: st,
      statusLabel: TICKET_LABEL_ADMIN[st],
      priority: pr,
      priorityLabel: PRIORITY_LABEL[pr],
      aiReplied: strOrNull(x.ai_replied_at) !== null,
      needsHuman: num(x.needs_human) === 1,
      assigneeId: strOrNull(x.assignee_id),
      assigneeName: strOrNull(x.assignee_name),
      messageCount: num(x.msg_count),
      createdAt: str(x.created_at),
      updatedAt: str(x.updated_at) || str(x.created_at),
    };
  });

  /* ★件数は、絞り込む前に数えること。
       絞り込んだあとで数えると、絞るたびに全体の件数が減り、
       画面を見た人は「問い合わせが消えた」と受け取ります */
  const counts: TicketCounts = {
    all: rows.length,
    open: rows.filter((x) => isOpenTicket(x.status)).length,
    new: rows.filter((x) => x.status === "NEW").length,
    aiReplied: rows.filter((x) => x.status === "AI_REPLIED").length,
    humanReview: rows.filter((x) => x.status === "HUMAN_REVIEW").length,
    inProgress: rows.filter((x) => x.status === "IN_PROGRESS").length,
    resolved: rows.filter((x) => x.status === "RESOLVED").length,
    high: rows.filter((x) => x.priority === "HIGH" && isOpenTicket(x.status)).length,
    unassigned: rows.filter((x) => x.assigneeId === null && isOpenTicket(x.status)).length,
  };

  const q = (filter.q ?? "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (x) =>
        x.id.toLowerCase().includes(q) ||
        x.userId.toLowerCase().includes(q) ||
        x.displayId.toLowerCase().includes(q) ||
        x.userName.toLowerCase().includes(q) ||
        (x.emailMasked ?? "").toLowerCase().includes(q) ||
        x.subject.toLowerCase().includes(q),
    );
  }

  const st = (filter.status ?? "").trim().toUpperCase();
  if (isTicketStatus(st)) rows = rows.filter((x) => x.status === st);

  if (filter.onlyHigh) rows = rows.filter((x) => x.priority === "HIGH");
  if (filter.onlyUnassigned) rows = rows.filter((x) => x.assigneeId === null);
  if (filter.onlyOpen) rows = rows.filter((x) => isOpenTicket(x.status));
  if (filter.assigneeId) {
    rows = rows.filter((x) => x.assigneeId === filter.assigneeId);
  }

  return { rows, total: rows.length, counts, canReply };
}

/**
 * 1件の詳細（やり取りつき）。
 *
 * ★他社の問い合わせは「見つかりません」で返すこと（30項目の19番）。
 *   「他社のものです」と答えると、
 *   その番号が実在することを教えたことになります。
 */
export async function ticketDetail(
  tenantId: string,
  ticketId: string,
  role: Role | null,
): Promise<TicketDetail | null> {
  if (role === null || !can(role, "support.view")) return null;

  const r = await db().execute({
    sql: `SELECT t.*, c.display_id, c.name AS user_name, c.email,
                 c.status AS customer_status
            FROM support_tickets t
            LEFT JOIN customers c
                   ON c.tenant_id = t.tenant_id AND c.id = t.user_id
           WHERE t.tenant_id = ? AND t.id = ?
           LIMIT 1`,
    args: [tenantId, ticketId],
  });
  const t = r.rows[0] as Row | undefined;
  if (!t) return null;

  const m = await db().execute({
    sql: `SELECT id, seq, author_kind, author_name, body, sources,
                 created_at, edited_at, edited_by, original_body
            FROM ticket_messages
           WHERE tenant_id = ? AND ticket_id = ?
           ORDER BY seq ASC`,
    args: [tenantId, ticketId],
  });

  const messages: TicketMessage[] = (m.rows as Row[]).map((x) => {
    const kind = str(x.author_kind) as TicketMessage["authorKind"];
    const k = kind === "AI" || kind === "STAFF" ? kind : "CUSTOMER";
    let sources: string[] | null = null;
    const raw = strOrNull(x.sources);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) sources = parsed.map((v) => String(v));
      } catch {
        /* ★読めなかったら null。壊れたJSONを画面へ流さないこと */
        sources = null;
      }
    }
    return {
      id: str(x.id),
      seq: num(x.seq),
      authorKind: k,
      authorLabel: AUTHOR_LABEL[k],
      authorName: str(x.author_name),
      body: str(x.body),
      sources,
      createdAt: str(x.created_at),
      edited: strOrNull(x.edited_at) !== null,
      editedAt: strOrNull(x.edited_at),
      editedBy: strOrNull(x.edited_by),
      originalBody: strOrNull(x.original_body),
    };
  });

  const st = statusOf(t.status);
  const pr = priorityOf(t.priority);
  const cat = strOrNull(t.category);

  return {
    id: str(t.id),
    displayId: str(t.display_id),
    userId: str(t.user_id),
    userName: str(t.user_name),
    email: strOrNull(t.email),
    customerStatus: str(t.customer_status),
    subject: str(t.subject),
    category: cat,
    categoryLabel: categoryLabelOf(cat),
    status: st,
    statusLabel: TICKET_LABEL_ADMIN[st],
    priority: pr,
    priorityLabel: PRIORITY_LABEL[pr],
    aiReplied: strOrNull(t.ai_replied_at) !== null,
    aiRepliedAt: strOrNull(t.ai_replied_at),
    needsHuman: num(t.needs_human) === 1,
    escalateReason: strOrNull(t.escalate_reason),
    aiDraft: strOrNull(t.ai_draft),
    assigneeId: strOrNull(t.assignee_id),
    assigneeName: strOrNull(t.assignee_name),
    createdAt: str(t.created_at),
    updatedAt: str(t.updated_at) || str(t.created_at),
    messages,
  };
}

/** ダッシュボードが使う件数。★ここ1か所で数えること */
export async function ticketCounts(tenantId: string): Promise<TicketCounts> {
  const { counts } = await ticketList(tenantId, "SUPER_ADMIN", {});
  return counts;
}

export type Assignee = { id: string; name: string; role: string };

/**
 * 担当者に選べる人。
 *
 * ★返信できない人を、選択肢に出さないこと（30項目の12番）。
 *   出すと、一覧の上では「対応中」に見えるのに、
 *   割り当てられた本人には返信ボタンが出ません。
 *   誰も気づかないまま、お客様だけが待ち続けます。
 *
 * ★止まっている担当者も、出さないこと。
 *   割り当てた瞬間から、その人はログインすらできません。
 */
export async function assignableStaff(
  tenantId: string,
  role: Role | null,
): Promise<Assignee[]> {
  if (role === null || !can(role, "support.view")) return [];

  const r = await db().execute({
    sql: `SELECT id, name, role FROM app_users
           WHERE tenant_id = ? AND status = 'ACTIVE'
           ORDER BY name`,
    args: [tenantId],
  });

  return (r.rows as Row[])
    .filter((u) => can(str(u.role) as Role, "support.reply"))
    .map((u) => ({
      id: str(u.id),
      name: str(u.name),
      role: str(u.role),
    }));
}

/* ══════════════════════════════════════════════
   書き込みの共通部分
   ══════════════════════════════════════════════ */

export type ActorBy = {
  adminId: string;
  name: string;
  role: string;
};

/** 取引の中で、その会社の問い合わせを1件つかむ */
async function grab(
  tx: Transaction,
  tenantId: string,
  ticketId: string,
): Promise<Row> {
  const r = await tx.execute({
    sql: `SELECT * FROM support_tickets WHERE tenant_id = ? AND id = ? LIMIT 1`,
    args: [tenantId, ticketId],
  });
  const t = r.rows[0] as Row | undefined;
  if (!t) {
    throw new TicketAdminError(
      "NOT_FOUND",
      "その問い合わせは見つかりませんでした。",
    );
  }
  return t;
}

/**
 * やり取りを1件足す。
 *
 * ★並び番号は、その場で数え直すこと。
 *   件数を画面から受け取ってはいけません。
 *   受け取ると、2人が同時に返信したときに同じ番号になります。
 *   同じ番号は索引が弾きますが、弾かれるより、
 *   その場で数えたほうが確実です。
 */
async function addMessage(
  tx: Transaction,
  args: {
    tenantId: string;
    ticketId: string;
    authorKind: TicketMessage["authorKind"];
    authorId: string | null;
    authorName: string;
    body: string;
    sources?: string[] | null;
    at: string;
  },
): Promise<number> {
  const last = await tx.execute({
    sql: `SELECT COALESCE(MAX(seq), 0) AS n FROM ticket_messages
           WHERE tenant_id = ? AND ticket_id = ?`,
    args: [args.tenantId, args.ticketId],
  });
  const seq = num((last.rows[0] as Row).n) + 1;

  await tx.execute({
    sql: `INSERT INTO ticket_messages
            (id, tenant_id, ticket_id, seq, author_kind, author_id, author_name,
             body, sources, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id("tmsg"),
      args.tenantId,
      args.ticketId,
      seq,
      args.authorKind,
      args.authorId,
      args.authorName,
      args.body,
      args.sources && args.sources.length > 0
        ? JSON.stringify(args.sources)
        : null,
      args.at,
    ],
  });
  return seq;
}

/* ══════════════════════════════════════════════
   AIの一次回答（30項目の6・7・8・11番）
   ══════════════════════════════════════════════ */

export type AiReplyResult = {
  ticketId: string;
  /** 答えたか、人へ回したか */
  outcome: "AI_REPLIED" | "HUMAN_REVIEW";
  status: TicketStatus;
  statusLabel: string;
  /** 人へ回した理由。答えたときは null */
  escalateReason: string | null;
  /** AIの文面。人へ回したときは、下書きも作らない */
  draft: string | null;
  sources: string[];
  auditSeq: number;
};

/**
 * AIに一次回答を作らせる。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここでやっていること・やっていないこと
 * ═══════════════════════════════════════════════════════
 *
 *   やっている  … そのお客様の注文・発送・残高・抽選履歴を読み、
 *                  「調べれば分かること」だけを文章にする
 *   やっていない … 外部のAIサービスへ本文を送ること
 *
 *   ★外部につないでいないことを、隠さないこと。
 *     つないでいないのに「AIが考えました」と書くと、
 *     受け取った方は、実際より賢いものだと思い込みます。
 *     ここは、決まった調べものを決まった形で書く仕組みです。
 *     外部のAIへ本文を送る形にするときは、
 *     「お客様の本文を社外へ送ってよいか」を先に決めてください。
 *
 * ★答えたからといって、解決済みにしないこと（30項目の11番）。
 *   状態は AI_REPLIED までです。
 *   解決にするのは、人だけです。
 */
export async function aiFirstReply(args: {
  tenantId: string;
  ticketId: string;
  by: ActorBy;
  requestId: string;
  now?: string;
}): Promise<AiReplyResult> {
  const at = args.now ?? new Date().toISOString();

  return withWriteTx(async (tx) => {
    const t = await grab(tx, args.tenantId, args.ticketId);
    const nowStatus = statusOf(t.status);

    /* ★2回目を作らせないこと。
         作らせると、下書きが上書きされます。
         人が読みかけていた文が、黙って別の文に変わります */
    if (strOrNull(t.ai_replied_at) !== null || strOrNull(t.ai_draft) !== null) {
      throw new TicketAdminError(
        "ALREADY_AI_REPLIED",
        "この問い合わせには、すでにAIの一次回答があります。",
      );
    }
    if (nowStatus === "RESOLVED") {
      throw new TicketAdminError(
        "SAME_VALUE",
        "解決済みの問い合わせに、あとからAIの回答を足すことはできません。",
      );
    }

    const subject = str(t.subject);
    const body = str(t.body);
    const userId = str(t.user_id);

    /* ── ① AIに答えさせてよいかを、先に決める ───────── */
    const naze = escalationReason(subject, body);
    const category = strOrNull(t.category) ?? guessCategory(subject, body);

    if (naze) {
      await tx.execute({
        sql: `UPDATE support_tickets
                 SET status = 'HUMAN_REVIEW', needs_human = 1,
                     escalate_reason = ?, category = COALESCE(category, ?),
                     updated_at = ?
               WHERE tenant_id = ? AND id = ?`,
        args: [naze, category, at, args.tenantId, args.ticketId],
      });

      const audit = await appendAuditTx(tx, {
        tenantId: args.tenantId,
        at,
        actorKind: "SYSTEM",
        actorId: "ai",
        actorName: "AI（一次回答）",
        actorRole: "SYSTEM",
        action: "TICKET_STATUS_CHANGED",
        target: args.ticketId,
        summary: "AIが答えず、人の確認へ回しました。",
        before: nowStatus,
        after: "HUMAN_REVIEW",
        reason: naze,
        requestId: args.requestId,
        data: { ticketId: args.ticketId, userId, escalated: true },
      });

      return {
        ticketId: args.ticketId,
        outcome: "HUMAN_REVIEW" as const,
        status: "HUMAN_REVIEW" as TicketStatus,
        statusLabel: TICKET_LABEL_ADMIN.HUMAN_REVIEW,
        escalateReason: naze,
        draft: null,
        sources: [],
        auditSeq: audit.seq,
      };
    }

    /* ── ② 答えてよいものだけ、その人の記録を読む ────── */
    const { draft, sources } = await buildDraft(tx, {
      tenantId: args.tenantId,
      userId,
      subject,
      body,
      category,
    });

    await tx.execute({
      sql: `UPDATE support_tickets
               SET status = 'AI_REPLIED', ai_draft = ?, ai_replied_at = ?,
                   needs_human = 0, category = COALESCE(category, ?),
                   updated_at = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [draft, at, category, at, args.tenantId, args.ticketId],
    });

    await addMessage(tx, {
      tenantId: args.tenantId,
      ticketId: args.ticketId,
      authorKind: "AI",
      authorId: "ai",
      authorName: "AI（一次回答）",
      body: draft,
      sources,
      at,
    });

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "SYSTEM",
      actorId: "ai",
      actorName: "AI（一次回答）",
      actorRole: "SYSTEM",
      action: "AI_REPLY_CREATED",
      target: args.ticketId,
      summary: "AIが一次回答を作成しました。",
      before: nowStatus,
      after: "AI_REPLIED",
      requestId: args.requestId,
      /* ★何を見て書いたかを残すこと。
           残っていないと、間違った案内をしたときに
           どこを直せばよいかが分かりません */
      data: { ticketId: args.ticketId, userId, sources },
    });

    return {
      ticketId: args.ticketId,
      outcome: "AI_REPLIED" as const,
      status: "AI_REPLIED" as TicketStatus,
      statusLabel: TICKET_LABEL_ADMIN.AI_REPLIED,
      escalateReason: null,
      draft,
      sources,
      auditSeq: audit.seq,
    };
  });
}

/**
 * 下書きを組み立てる。
 *
 * ★必ず tenant_id と user_id の両方で絞ること（30項目の6番）。
 *   片方だけにすると、他社のお客様の発送状況が混ざります。
 */
async function buildDraft(
  tx: Transaction,
  args: {
    tenantId: string;
    userId: string;
    subject: string;
    body: string;
    category: TicketCategory | string | null;
  },
): Promise<{ draft: string; sources: string[] }> {
  const sources: string[] = [];
  const lines: string[] = ["お問い合わせいただき、ありがとうございます。"];

  const cat = args.category;

  /* ── 発送のこと ───────────────────────── */
  if (cat === "SHIPPING" || cat === "PRIZE") {
    /*
      ★列の名前を、思い出しで書かないこと。
        2026-08-27 に、ここは status / tracking_no と書いてありました。
        実際の表は shipment_status / tracking_number です。
        画面では「AIが答えられませんでした」としか出ないので、
        誰も間違いに気づけません。
        tests/ticketAdmin.test.ts が、これを見張ります。
    */
    const s = await tx.execute({
      sql: `SELECT id, shipment_number, shipment_status,
                   carrier, tracking_number, shipped_at
              FROM shipments
             WHERE tenant_id = ? AND user_id = ?
             ORDER BY created_at DESC LIMIT 1`,
      args: [args.tenantId, args.userId],
    });
    /* ★「見にいった」ことも、必ず根拠に残すこと（30項目の8番）。
         見つからなかったときに何も残さないと、あとから
         「発送を確認しないまま『ございません』と答えたのか」
         「確認したうえで無かったのか」を区別できません。
         苦情になったときに、いちばん聞かれるのがそこです。 */
    sources.push(`shipments:${args.userId}`);

    const sh = s.rows[0] as Row | undefined;
    if (sh) {
      sources.push(`shipment:${str(sh.id)}`);
      const tn = strOrNull(sh.tracking_number);
      const carrier = strOrNull(sh.carrier);
      const st = str(sh.shipment_status);

      if (st === "CANCELLED") {
        /* ★取り消した発送を「準備中です」と言わないこと。
             待っていれば届くと思われ、二重に手間が増えます */
        lines.push(
          "直近のご発送は、取り消しの手続きが行われております。詳しい状況は、担当者よりご案内いたします。",
        );
      } else if (st === "DELIVERED") {
        lines.push("直近のご発送は、お届けが完了しております。");
      } else if ((st === "SHIPPED" || st === "IN_TRANSIT") && tn) {
        lines.push(
          `直近のご発送は、${carrier ?? "配送業者"}のお問い合わせ番号 ${tn} で発送済みでございます。`,
        );
      } else if (st === "SHIPPED" || st === "IN_TRANSIT") {
        lines.push(
          "直近のご発送は、発送済みでございます。お問い合わせ番号が分かり次第、あらためてご案内いたします。",
        );
      } else {
        lines.push(
          "直近のご発送は、ただいま準備を進めております。発送が完了しましたら、あらためてご案内いたします。",
        );
      }
    } else {
      lines.push("現在、発送手続き中のお品はございません。");
    }
  }

  /* ── ポイントのこと ─────────────────────── */
  if (cat === "POINT") {
    const p = await tx.execute({
      sql: `SELECT COALESCE(SUM(delta), 0) AS n FROM point_ledger
             WHERE tenant_id = ? AND user_id = ?`,
      args: [args.tenantId, args.userId],
    });
    const zan = num((p.rows[0] as Row).n);
    sources.push(`point_ledger:${args.userId}`);
    lines.push(`現在のポイント残高は ${zan.toLocaleString()}pt でございます。`);

    const l = await tx.execute({
      sql: `SELECT kind, delta, created_at FROM point_ledger
             WHERE tenant_id = ? AND user_id = ?
             ORDER BY created_at DESC, id DESC LIMIT 3`,
      args: [args.tenantId, args.userId],
    });
    if (l.rows.length > 0) {
      lines.push("直近の増減は、次のとおりです。");
      for (const x of l.rows as Row[]) {
        const d = num(x.delta);
        lines.push(
          `・${str(x.created_at).slice(0, 10)}　${d > 0 ? "+" : ""}${d.toLocaleString()}pt`,
        );
      }
    }
  }

  /* ── ガチャのこと ───────────────────────── */
  if (cat === "GACHA") {
    const d = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM draws
             WHERE tenant_id = ? AND user_id = ?`,
      args: [args.tenantId, args.userId],
    });
    sources.push(`draws:${args.userId}`);
    lines.push(
      `これまでのご利用回数は ${num((d.rows[0] as Row).n).toLocaleString()} 回でございます。`,
    );
    lines.push(
      "各ガチャの当選確率は、商品ページに記載しております。抽選は1回ごとに独立して行われます。",
    );
  }

  /* ── アカウントのこと ───────────────────── */
  if (cat === "ACCOUNT") {
    lines.push(
      "ログインに関するお手続きは、ログイン画面の「パスワードをお忘れの方」からお進みいただけます。",
    );
  }

  /* ★調べても何も言えなかったときに、
       それらしい文章で埋めないこと。
       埋めると、中身のない返事が送られます */
  if (lines.length === 1) {
    lines.push(
      "いただいた内容を確認いたしました。詳細を確認のうえ、担当者よりあらためてご連絡いたします。",
    );
  }

  lines.push("");
  lines.push("引き続きよろしくお願いいたします。");

  return { draft: lines.join("\n"), sources };
}

/* ══════════════════════════════════════════════
   人が返信する（30項目の9番）
   ══════════════════════════════════════════════ */

export type ReplyResult = {
  ticketId: string;
  seq: number;
  status: TicketStatus;
  statusLabel: string;
  auditSeq: number;
};

/**
 * 担当者が返信する。
 *
 * ★返信しただけで「解決済み」にしないこと。
 *   お客様がまだ納得していないかもしれません。
 *   解決にするのは、別の操作にします。
 */
export async function replyAsHuman(args: {
  tenantId: string;
  ticketId: string;
  text: string;
  by: ActorBy;
  requestId: string;
  now?: string;
  /** 送信と同時に解決にする場合だけ true */
  resolve?: boolean;
}): Promise<ReplyResult> {
  const at = args.now ?? new Date().toISOString();
  const text = args.text.trim();

  if (text.length < MIN_REPLY) {
    throw new TicketAdminError(
      "TOO_SHORT",
      `返信の内容を、${MIN_REPLY}文字以上でご記入ください。`,
    );
  }
  if (text.length > MAX_REPLY) {
    throw new TicketAdminError(
      "TOO_LONG",
      `返信が長すぎます（${MAX_REPLY}文字まで）。`,
    );
  }

  return withWriteTx(async (tx) => {
    const t = await grab(tx, args.tenantId, args.ticketId);
    const before = statusOf(t.status);

    if (before === "RESOLVED") {
      throw new TicketAdminError(
        "SAME_VALUE",
        "解決済みの問い合わせには返信できません。もう一度みる場合は、状態を「対応中」に戻してください。",
      );
    }

    const seq = await addMessage(tx, {
      tenantId: args.tenantId,
      ticketId: args.ticketId,
      authorKind: "STAFF",
      authorId: args.by.adminId,
      authorName: args.by.name,
      body: text,
      at,
    });

    const after: TicketStatus = args.resolve ? "RESOLVED" : "IN_PROGRESS";

    await tx.execute({
      /* ★answer にも最新の1件を写しておく。
           お客様の画面（mypage）が、古い作りのまま
           answer を読んでいる場合に、食い違わないようにするためです。
           正本は ticket_messages です */
      sql: `UPDATE support_tickets
               SET status = ?, needs_human = 0, answer = ?,
                   answered_at = ?, answered_by = ?, updated_at = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [
        after,
        text,
        at,
        args.by.adminId,
        at,
        args.tenantId,
        args.ticketId,
      ],
    });

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      action: "HUMAN_REPLY_CREATED",
      target: args.ticketId,
      summary: "担当者が返信しました。",
      before,
      after,
      requestId: args.requestId,
      data: {
        ticketId: args.ticketId,
        userId: str(t.user_id),
        seq,
        length: text.length,
      },
    });

    /**
     * お客様へ「返事が来ました」を1件だけ作る（30項目の16番）。
     *
     * ★メールはまだつないでいません。Mock です。
     *   だから、本当に外へ出たかどうかを notifications の
     *   provider / reallySent に必ず残します。
     *   「送りました」と画面に書いておいて実は出ていない、
     *   がいちばんやってはいけないことです。
     *
     * ★同じ書き込み（tx）の中で作ること。
     *   別々に書くと、返信は残ったのにお知らせが無い、
     *   あるいはその逆が起きます。
     *
     * ★AIの下書き（aiFirstReply）では作らないこと。
     *   下書きは、まだお客様の目に触れていません。
     *   「返事が来ました」と知らせておいて、開いたら何も無い、
     *   が起きます。人が送信を押したときだけです。
     *
     * ★お知らせに、返信の本文をそのまま入れないこと。
     *   お知らせは一覧に並びます。本文には、
     *   本人にしか出してはいけない話が入ります。
     */
    await notifyTx(tx, {
      tenantId: args.tenantId,
      userId: str(t.user_id),
      kind: "TICKET_REPLIED",
      title: "お問い合わせに、返信が届きました",
      body: `「${str(t.subject)}」について、サポート担当からの返信が届いています。マイページの「お問い合わせ」からご確認ください。`,
      refKind: "TICKET",
      refId: args.ticketId,
      /* ★1返信につき1通。seq を必ず混ぜること。
           ticketId だけにすると、2通目以降が
           「もう出してある」と判定されて、黙って消えます */
      dedupeKey: `TICKET_REPLIED:${args.ticketId}:${seq}`,
      at,
      requestId: args.requestId,
      actor: {
        kind: "ADMIN",
        id: args.by.adminId,
        name: args.by.name,
        role: args.by.role,
      },
    });

    if (args.resolve) {
      await appendAuditTx(tx, {
        tenantId: args.tenantId,
        at,
        actorKind: "ADMIN",
        actorId: args.by.adminId,
        actorName: args.by.name,
        actorRole: args.by.role,
        action: "TICKET_RESOLVED",
        target: args.ticketId,
        summary: "返信と同時に、解決済みにしました。",
        before,
        after: "RESOLVED",
        requestId: args.requestId,
        data: { ticketId: args.ticketId, userId: str(t.user_id) },
      });
    }

    return {
      ticketId: args.ticketId,
      seq,
      status: after,
      statusLabel: TICKET_LABEL_ADMIN[after],
      auditSeq: audit.seq,
    };
  });
}

/* ══════════════════════════════════════════════
   担当者を決める（30項目の12番）
   ══════════════════════════════════════════════ */

export async function assignTicket(args: {
  tenantId: string;
  ticketId: string;
  /** null なら、担当を外す */
  assigneeId: string | null;
  by: ActorBy;
  requestId: string;
  now?: string;
}): Promise<{ ticketId: string; assigneeId: string | null; assigneeName: string | null; auditSeq: number }> {
  const at = args.now ?? new Date().toISOString();

  return withWriteTx(async (tx) => {
    const t = await grab(tx, args.tenantId, args.ticketId);
    const beforeId = strOrNull(t.assignee_id);
    const beforeName = strOrNull(t.assignee_name);

    if (beforeId === args.assigneeId) {
      throw new TicketAdminError(
        "SAME_VALUE",
        "すでに、その担当者になっています。",
      );
    }

    let name: string | null = null;
    if (args.assigneeId !== null) {
      /* ★他社の担当者を割り当てられないようにすること。
           tenant_id を外すと、隣の会社の人の名前が入ります */
      const u = await tx.execute({
        sql: `SELECT name, role, status FROM app_users
               WHERE tenant_id = ? AND id = ? LIMIT 1`,
        args: [args.tenantId, args.assigneeId],
      });
      const row = u.rows[0] as Row | undefined;
      if (!row) {
        throw new TicketAdminError(
          "NO_ASSIGNEE",
          "その担当者は見つかりませんでした。",
        );
      }
      if (str(row.status) === "SUSPENDED") {
        throw new TicketAdminError(
          "NO_ASSIGNEE",
          "利用を停止している担当者には、割り当てできません。",
        );
      }
      /* ★返信できない役割を担当にしないこと。
           担当になっているのに返信できない人は、
           一覧の上では「対応中」に見えて、実際には何も進みません */
      const role = str(row.role) as Role;
      if (!can(role, "support.reply")) {
        throw new TicketAdminError(
          "NO_ASSIGNEE",
          "その担当者には、問い合わせに返信する権限がありません。",
        );
      }
      name = str(row.name);
    }

    await tx.execute({
      sql: `UPDATE support_tickets
               SET assignee_id = ?, assignee_name = ?, updated_at = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [args.assigneeId, name, at, args.tenantId, args.ticketId],
    });

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      action: "TICKET_ASSIGNED",
      target: args.ticketId,
      summary:
        args.assigneeId === null
          ? "担当者を外しました。"
          : `担当者を ${name} にしました。`,
      before: beforeName ?? "（未担当）",
      after: name ?? "（未担当）",
      requestId: args.requestId,
      data: {
        ticketId: args.ticketId,
        beforeId,
        afterId: args.assigneeId,
      },
    });

    return {
      ticketId: args.ticketId,
      assigneeId: args.assigneeId,
      assigneeName: name,
      auditSeq: audit.seq,
    };
  });
}

/* ══════════════════════════════════════════════
   状態を変える（30項目の10・11番）
   ══════════════════════════════════════════════ */

export async function changeTicketStatus(args: {
  tenantId: string;
  ticketId: string;
  to: string;
  reason: string;
  by: ActorBy;
  requestId: string;
  now?: string;
}): Promise<{ ticketId: string; before: TicketStatus; after: TicketStatus; statusLabel: string; auditSeq: number }> {
  const at = args.now ?? new Date().toISOString();
  const reason = args.reason.trim();

  if (!isTicketStatus(args.to)) {
    throw new TicketAdminError(
      "BAD_STATUS",
      "知らない状態です。決まっている状態からお選びください。",
    );
  }
  /* ★理由なしで状態を変えさせないこと。
       いちばん多い問い合わせは「なぜ解決済みになっているのか」です。
       理由が無ければ、答えようがありません */
  if (reason.length < MIN_REASON) {
    throw new TicketAdminError(
      "NO_REASON",
      `状態を変える理由を、${MIN_REASON}文字以上でご記入ください。`,
    );
  }

  return withWriteTx(async (tx) => {
    const t = await grab(tx, args.tenantId, args.ticketId);
    const before = statusOf(t.status);
    const to = args.to as TicketStatus;

    if (before === to) {
      throw new TicketAdminError("SAME_VALUE", "すでに、その状態です。");
    }
    if (!canMoveTicket(before, to)) {
      throw new TicketAdminError(
        "BAD_STATUS",
        "その状態へは戻せません。もう一度みる場合は「対応中」をお選びください。",
      );
    }

    await tx.execute({
      sql: `UPDATE support_tickets
               SET status = ?, needs_human = ?, updated_at = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [
        to,
        to === "HUMAN_REVIEW" ? 1 : 0,
        at,
        args.tenantId,
        args.ticketId,
      ],
    });

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      action: to === "RESOLVED" ? "TICKET_RESOLVED" : "TICKET_STATUS_CHANGED",
      target: args.ticketId,
      summary: `状態を「${TICKET_LABEL_ADMIN[before]}」から「${TICKET_LABEL_ADMIN[to]}」へ変えました。`,
      before,
      after: to,
      reason,
      requestId: args.requestId,
      data: { ticketId: args.ticketId, userId: str(t.user_id) },
    });

    return {
      ticketId: args.ticketId,
      before,
      after: to,
      statusLabel: TICKET_LABEL_ADMIN[to],
      auditSeq: audit.seq,
    };
  });
}

/* ══════════════════════════════════════════════
   優先度を変える
   ══════════════════════════════════════════════ */

export async function changeTicketPriority(args: {
  tenantId: string;
  ticketId: string;
  to: string;
  reason: string;
  by: ActorBy;
  requestId: string;
  now?: string;
}): Promise<{ ticketId: string; before: TicketPriority; after: TicketPriority; auditSeq: number }> {
  const at = args.now ?? new Date().toISOString();
  const reason = args.reason.trim();

  if (!isTicketPriority(args.to)) {
    throw new TicketAdminError("BAD_STATUS", "知らない優先度です。");
  }
  if (reason.length < MIN_REASON) {
    throw new TicketAdminError(
      "NO_REASON",
      `優先度を変える理由を、${MIN_REASON}文字以上でご記入ください。`,
    );
  }

  return withWriteTx(async (tx) => {
    const t = await grab(tx, args.tenantId, args.ticketId);
    const before = priorityOf(t.priority);
    const to = args.to as TicketPriority;

    if (before === to) {
      throw new TicketAdminError("SAME_VALUE", "すでに、その優先度です。");
    }

    await tx.execute({
      sql: `UPDATE support_tickets SET priority = ?, updated_at = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [to, at, args.tenantId, args.ticketId],
    });

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: args.by.adminId,
      actorName: args.by.name,
      actorRole: args.by.role,
      action: "TICKET_STATUS_CHANGED",
      target: args.ticketId,
      summary: `優先度を「${PRIORITY_LABEL[before]}」から「${PRIORITY_LABEL[to]}」へ変えました。`,
      before: `優先度:${before}`,
      after: `優先度:${to}`,
      reason,
      requestId: args.requestId,
      data: { ticketId: args.ticketId },
    });

    return { ticketId: args.ticketId, before, after: to, auditSeq: audit.seq };
  });
}
