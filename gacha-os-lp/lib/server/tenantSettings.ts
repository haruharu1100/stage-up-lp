/**
 * お店の「看板」と「法定ページ」を、お店ごとに預かる場所。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルが無いと、何が起きるのか
 * ═══════════════════════════════════════════════════════
 *
 *   お客様が「特定商取引法に基づく表記」を開いたとき、
 *   そこに出る会社名・住所・電話番号は、
 *   ★そのお店のものでなければなりません。
 *
 *   ここを作らないと、2社目に売った日から、
 *   こちらが毎回手で書き込むことになります。
 *   それは「毎回こちらが設定してあげる受託システム」であって、
 *   複数社へ売れる商品ではありません。
 *
 * ═══════════════════════════════════════════════════════
 * ★いちばんやってはいけないこと：既定値で埋めること
 * ═══════════════════════════════════════════════════════
 *
 *   画面に「未設定」と並ぶのは、見た目が良くありません。
 *   ですので、こういうことをしたくなります。
 *
 *       会社名が空 → とりあえず AI GACHA OS 運営会社を入れておく
 *       返品の記載が空 → 一般的な文例を入れておく
 *
 *   ★どちらも、してはいけません。
 *
 *   前者をやると、そのお店の特商法ページに、
 *   ★こちらの会社名と住所が出ます。
 *     お客様は、こちらへ返品を求めてきます。
 *     こちらは、その取引の当事者ではありません。
 *
 *   後者はもっと悪いです。
 *   返品の条件は、お店ごとに違います。
 *   こちらが入れた文例は「そのお店が表示した返品特約」になります。
 *   ★文例を入れた瞬間、こちらが、そのお店の法的な表示を代筆したことになります。
 *
 *   ですので、この仕組みの答えは1つだけです。
 *
 *       ★空欄は、空欄のまま「未設定」と出す。
 *         そして、未設定のままでは公開させない。
 *
 *   きれいに見せるのではなく、埋めるまで進ませない、という形にします。
 *
 * ═══════════════════════════════════════════════════════
 * ★項目を1つの大きな文章欄にしなかった理由
 * ═══════════════════════════════════════════════════════
 *
 *   特商法の表記を「1つの自由記入欄」にすれば、実装は半分で済みます。
 *   ですが、そうすると
 *   ★どの項目が抜けているかを、機械で数えられなくなります。
 *
 *   数えられないものは、公開前に止められません。
 *   止められないなら、公開準備の「○/○完了」は嘘になります。
 *
 *   ですので、項目ごとに列を持ちます。
 *   面倒なほうを選んでいますが、面倒なのは作るときの1回だけで、
 *   数えられないことの困りごとは、お店の数だけ増えます。
 */

import { withWriteTx, db } from "./db";
import { appendAuditTx } from "./audit";
import { id } from "./ids";
import type { Actor } from "./orders";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));

/** 空白だけの入力を「入っている」と数えないための整え */
const trim = (v: unknown): string => str(v).trim();

/** 空なら null。★空文字を保存しないこと（「空」と「未設定」が混ざります） */
const nz = (v: unknown): string | null => trim(v) || null;

export class TenantSettingsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TenantSettingsError";
    this.code = code;
  }
}

/* ══════════════════════════════════════════════
   どんな項目があるか
   ══════════════════════════════════════════════ */

/**
 * 保存できる項目の一覧。
 *
 * ★ここを「文字列なら何でも受ける」形にしないこと。
 *   受けてしまうと、画面のtypoが、そのまま新しい列名として通り、
 *   保存したのに出てこない、という直しにくい不具合になります。
 */
export const SETTING_FIELDS = [
  /* 看板 */
  "shopName",
  "logoImageId",
  "brandColor",

  /* 運営法人（特商法の「販売業者」でもある） */
  "legalName",
  "legalKana",
  "representative",
  "postalCode",
  "address",
  "phone",
  "contactEmail",
  "contactHours",
  "contactNote",
  "antiqueLicense",

  /* 特商法の各項目 */
  "priceNote",
  "extraFeeNote",
  "paymentMethod",
  "paymentTiming",
  "deliveryTime",
  "returnsNote",

  /* 長い文章のページ */
  "termsText",
  "privacyText",
] as const;

export type SettingField = (typeof SETTING_FIELDS)[number];

/** 見せる名前。★画面ごとに書き直さないこと（言い方が画面ごとにズレます） */
export const FIELD_LABEL: Record<SettingField, string> = {
  shopName: "店舗名",
  logoImageId: "ロゴ画像",
  brandColor: "ブランドカラー",

  legalName: "運営法人名（販売業者）",
  legalKana: "法人名のふりがな",
  representative: "代表者名",
  postalCode: "郵便番号",
  address: "所在地",
  phone: "電話番号",
  contactEmail: "問い合わせメールアドレス",
  contactHours: "問い合わせ受付時間",
  contactNote: "問い合わせについての補足",
  antiqueLicense: "古物商許可番号",

  priceNote: "販売価格について",
  extraFeeNote: "商品代金以外に必要な料金（送料など）",
  paymentMethod: "支払方法",
  paymentTiming: "支払時期",
  deliveryTime: "商品の引渡時期",
  returnsNote: "返品・交換について",

  termsText: "利用規約",
  privacyText: "プライバシーポリシー",
};

/** DBの列名との対応。★ここ1か所だけに持つこと */
const COLUMN: Record<SettingField, string> = {
  shopName: "shop_name",
  logoImageId: "logo_image_id",
  brandColor: "brand_color",

  legalName: "legal_name",
  legalKana: "legal_kana",
  representative: "representative",
  postalCode: "postal_code",
  address: "address",
  phone: "phone",
  contactEmail: "contact_email",
  contactHours: "contact_hours",
  contactNote: "contact_note",
  antiqueLicense: "antique_license",

  priceNote: "price_note",
  extraFeeNote: "extra_fee_note",
  paymentMethod: "payment_method",
  paymentTiming: "payment_timing",
  deliveryTime: "delivery_time",
  returnsNote: "returns_note",

  termsText: "terms_text",
  privacyText: "privacy_text",
};

/**
 * 公開するために、必ず埋まっていなければならない項目。
 *
 * ★ここに入れる／入れないの基準は「見た目」ではありません。
 *   「無いまま公開すると、法律上の表示が欠けるかどうか」です。
 *
 * ★antiqueLicense（古物商許可番号）を必須にしていない理由：
 *   中古品を扱わないお店があります。
 *   要る／要らないは、そのお店の商材で決まります。
 *   ★こちらが判断してよいことではないので、必須にしません。
 *   （代わりに、設定画面で「中古品を扱う場合は必要です」と伝えます）
 *
 * ★legalKana・contactNote・logoImageId・brandColor も必須にしていません。
 *   無くても、法律上の表示は欠けないからです。
 *   必須を増やしすぎると、お店は「とりあえず何か入れる」ようになり、
 *   必須という印そのものが効かなくなります。
 */
export const REQUIRED_FOR_PUBLISH: SettingField[] = [
  "shopName",

  "legalName",
  "representative",
  "postalCode",
  "address",
  "phone",
  "contactEmail",

  "priceNote",
  "extraFeeNote",
  "paymentMethod",
  "paymentTiming",
  "deliveryTime",
  "returnsNote",

  "termsText",
  "privacyText",
];

export type TenantSettings = {
  /** 値。未設定は null。★空文字にしないこと */
  values: Record<SettingField, string | null>;
  updatedAt: string | null;
  updatedBy: string | null;
  /** まだ埋まっていない必須項目（見せる名前つき） */
  missing: { field: SettingField; label: string }[];
  /** 必須がすべて埋まっているか */
  complete: boolean;
};

function toSettings(row: Row | null): TenantSettings {
  const values = {} as Record<SettingField, string | null>;
  for (const f of SETTING_FIELDS) {
    values[f] = row ? nz(row[COLUMN[f]]) : null;
  }

  const missing = REQUIRED_FOR_PUBLISH.filter((f) => !values[f]).map((f) => ({
    field: f,
    label: FIELD_LABEL[f],
  }));

  return {
    values,
    updatedAt: row ? nz(row.updated_at) : null,
    updatedBy: row ? nz(row.updated_by) : null,
    missing,
    complete: missing.length === 0,
  };
}

/**
 * いまの設定を読む。
 *
 * 1行も無ければ、全部「未設定」を返します。
 * ★無いことをエラーにしないこと。
 *   新しく契約したお店は、必ずこの状態から始まります。
 */
export async function getTenantSettings(
  tenantId: string,
): Promise<TenantSettings> {
  const cols = SETTING_FIELDS.map((f) => COLUMN[f]).join(", ");
  const res = await db().execute({
    sql: `SELECT ${cols}, updated_at, updated_by
            FROM tenant_settings WHERE tenant_id = ?`,
    args: [tenantId],
  });
  return toSettings((res.rows[0] as Row) ?? null);
}

/* ══════════════════════════════════════════════
   入力の確かめ
   ══════════════════════════════════════════════ */

/** 長さの上限。打ち間違いと、悪意ある巨大入力の両方を止めます */
const MAX_LEN: Partial<Record<SettingField, number>> = {
  termsText: 60_000,
  privacyText: 60_000,
  priceNote: 2_000,
  extraFeeNote: 2_000,
  paymentMethod: 2_000,
  paymentTiming: 2_000,
  deliveryTime: 2_000,
  returnsNote: 4_000,
  contactNote: 2_000,
};
const DEFAULT_MAX_LEN = 200;

/**
 * ブランドカラーは #rrggbb だけを受けます。
 *
 * ★ここを緩めないこと。
 *   この値は、そのまま画面のスタイルに入ります。
 *   自由な文字列を通すと、色の指定のふりをした別のものが
 *   混ざる道を開けることになります。
 */
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function checkOne(field: SettingField, raw: unknown): string | null {
  const v = trim(raw);
  if (v === "") return null;

  const max = MAX_LEN[field] ?? DEFAULT_MAX_LEN;
  if (v.length > max) {
    throw new TenantSettingsError(
      "TOO_LONG",
      `「${FIELD_LABEL[field]}」が長すぎます（${max.toLocaleString("ja-JP")}文字まで）。`,
    );
  }

  if (field === "brandColor" && !COLOR_RE.test(v)) {
    throw new TenantSettingsError(
      "BAD_COLOR",
      "ブランドカラーは #1a2b3c の形式で入力してください。",
    );
  }

  if (field === "contactEmail" && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)) {
    throw new TenantSettingsError(
      "BAD_EMAIL",
      "問い合わせメールアドレスの形式が正しくありません。",
    );
  }

  return v;
}

/* ══════════════════════════════════════════════
   保存
   ══════════════════════════════════════════════ */

/**
 * 設定を保存する（送られてきた項目だけを更新します）。
 *
 * ★送られてこなかった項目を、null で上書きしないこと。
 *   ウィザードは画面を分けて少しずつ保存します。
 *   1画面ぶんを保存するたびに、ほかの画面の入力が消えてはいけません。
 *
 * @param patch 変えたい項目だけを入れます。
 *   空文字を入れると「消す」意味になります（未設定へ戻します）。
 */
export async function saveTenantSettings(args: {
  tenantId: string;
  patch: Partial<Record<SettingField, unknown>>;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<TenantSettings> {
  const at = args.now ?? new Date().toISOString();

  /* 受け付ける項目だけに絞る。
     ★知らないキーは、黙って捨てずに落とすこと。
       黙って捨てると、画面側のtypoが「保存したのに出てこない」
       という、いちばん探しにくい不具合になります。 */
  const entries: [SettingField, string | null][] = [];
  for (const key of Object.keys(args.patch)) {
    if (!(SETTING_FIELDS as readonly string[]).includes(key)) {
      throw new TenantSettingsError(
        "UNKNOWN_FIELD",
        `知らない項目が送られました（${key}）。`,
      );
    }
    const f = key as SettingField;
    entries.push([f, checkOne(f, args.patch[f])]);
  }

  if (entries.length === 0) {
    throw new TenantSettingsError("EMPTY", "変更する項目がありません。");
  }

  return withWriteTx(async (tx) => {
    const cols = SETTING_FIELDS.map((f) => COLUMN[f]).join(", ");
    const cur = await tx.execute({
      sql: `SELECT ${cols}, updated_at, updated_by
              FROM tenant_settings WHERE tenant_id = ?`,
      args: [args.tenantId],
    });
    const mae = toSettings((cur.rows[0] as Row) ?? null);

    /* 1行も無ければ、まず空の行を作る */
    await tx.execute({
      sql: `INSERT INTO tenant_settings (tenant_id, updated_at, updated_by)
            VALUES (?,?,?)
            ON CONFLICT(tenant_id) DO NOTHING`,
      args: [args.tenantId, at, args.actor.name],
    });

    const sets = entries.map(([f]) => `${COLUMN[f]} = ?`).join(", ");
    await tx.execute({
      sql: `UPDATE tenant_settings
               SET ${sets}, updated_at = ?, updated_by = ?
             WHERE tenant_id = ?`,
      args: [
        ...entries.map(([, v]) => v),
        at,
        args.actor.name,
        args.tenantId,
      ],
    });

    /* 実際に中身が変わった項目だけを記録に残す。
       ★「保存を押した」を記録にしないこと。
         押しただけで何も変わっていない行が積み上がると、
         本当に変わった行が、その中に埋もれます。 */
    const kawatta = entries.filter(([f, v]) => mae.values[f] !== v);

    if (kawatta.length > 0) {
      /* ★長い本文を、そのまま before / after に入れないこと。
           規約は数万文字あります。監査ログが読めなくなります。
           残すのは「何を触ったか」と「文字数がどう変わったか」まで。 */
      const kesa = (v: string | null): string =>
        v == null ? "未設定" : `${v.length.toLocaleString("ja-JP")}文字`;

      const namae = kawatta.map(([f]) => FIELD_LABEL[f]).join("／");

      await appendAuditTx(tx, {
        tenantId: args.tenantId,
        at,
        actorKind: args.actor.kind,
        actorId: args.actor.id,
        actorName: args.actor.name,
        actorRole: args.actor.role,
        action: "TENANT_SETTINGS_UPDATED",
        target: args.tenantId,
        summary: `店舗情報・法定ページを変更しました（${namae}）`,
        before: kawatta
          .map(([f]) => `${FIELD_LABEL[f]}: ${kesa(mae.values[f])}`)
          .join(" / "),
        after: kawatta
          .map(([f, v]) => `${FIELD_LABEL[f]}: ${kesa(v)}`)
          .join(" / "),
        reason: "お店の設定変更",
        requestId: args.requestId,
        data: {
          fields: kawatta.map(([f]) => f),
          /* ★中身そのものは入れません。
               監査ログは多くの人が読みます。
               住所や電話番号を、記録の中で二重に持たないためです。 */
          lengthBefore: Object.fromEntries(
            kawatta.map(([f]) => [f, mae.values[f]?.length ?? null]),
          ),
          lengthAfter: Object.fromEntries(
            kawatta.map(([f, v]) => [f, v?.length ?? null]),
          ),
        },
      });
    }

    const after = { ...mae.values };
    for (const [f, v] of entries) after[f] = v;

    const missing = REQUIRED_FOR_PUBLISH.filter((f) => !after[f]).map((f) => ({
      field: f,
      label: FIELD_LABEL[f],
    }));

    return {
      values: after,
      updatedAt: at,
      updatedBy: args.actor.name,
      missing,
      complete: missing.length === 0,
    };
  });
}

/* ══════════════════════════════════════════════
   よくある質問（FAQ）
   ══════════════════════════════════════════════ */

export type Faq = {
  id: string;
  order: number;
  question: string;
  answer: string;
  updatedAt: string;
};

const FAQ_Q_MAX = 200;
const FAQ_A_MAX = 4_000;
/** ★上限を置く理由：無制限にすると、1店の設定でページが開かなくなります */
const FAQ_MAX_COUNT = 100;

export async function listFaqs(tenantId: string): Promise<Faq[]> {
  const res = await db().execute({
    sql: `SELECT id, sort_order, question, answer, updated_at
            FROM tenant_faqs WHERE tenant_id = ?
           ORDER BY sort_order ASC, updated_at ASC`,
    args: [tenantId],
  });
  return (res.rows as unknown as Row[]).map((r) => ({
    id: str(r.id),
    order: Number(r.sort_order ?? 0),
    question: str(r.question),
    answer: str(r.answer),
    updatedAt: str(r.updated_at),
  }));
}

/**
 * FAQ をまとめて入れ替える。
 *
 * ★1件ずつの追加・削除にしなかった理由：
 *   並び替えが、そのたびに別の操作になります。
 *   画面で並べ替えて「保存」を押す形のほうが、お店にとって分かりやすく、
 *   途中で失敗したときに中途半端な並びが残りません。
 */
export async function replaceFaqs(args: {
  tenantId: string;
  items: { question: unknown; answer: unknown }[];
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<Faq[]> {
  const at = args.now ?? new Date().toISOString();

  if (!Array.isArray(args.items)) {
    throw new TenantSettingsError("BAD_INPUT", "よくある質問の形式が正しくありません。");
  }
  if (args.items.length > FAQ_MAX_COUNT) {
    throw new TenantSettingsError(
      "TOO_MANY",
      `よくある質問は ${FAQ_MAX_COUNT} 件までです。`,
    );
  }

  const clean = args.items.map((it, i) => {
    const q = trim(it?.question);
    const a = trim(it?.answer);
    if (q === "" || a === "") {
      throw new TenantSettingsError(
        "EMPTY_ITEM",
        `${i + 1}件目の質問または答えが空です。空の行は削除してください。`,
      );
    }
    if (q.length > FAQ_Q_MAX) {
      throw new TenantSettingsError(
        "TOO_LONG",
        `${i + 1}件目の質問が長すぎます（${FAQ_Q_MAX}文字まで）。`,
      );
    }
    if (a.length > FAQ_A_MAX) {
      throw new TenantSettingsError(
        "TOO_LONG",
        `${i + 1}件目の答えが長すぎます（${FAQ_A_MAX.toLocaleString("ja-JP")}文字まで）。`,
      );
    }
    return { question: q, answer: a, order: i };
  });

  return withWriteTx(async (tx) => {
    const before = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM tenant_faqs WHERE tenant_id = ?`,
      args: [args.tenantId],
    });
    const maeCount = Number((before.rows[0] as Row)?.n ?? 0);

    await tx.execute({
      sql: `DELETE FROM tenant_faqs WHERE tenant_id = ?`,
      args: [args.tenantId],
    });

    const out: Faq[] = [];
    for (const c of clean) {
      const fid = id("faq");
      await tx.execute({
        sql: `INSERT INTO tenant_faqs
                (id, tenant_id, sort_order, question, answer, updated_at)
              VALUES (?,?,?,?,?,?)`,
        args: [fid, args.tenantId, c.order, c.question, c.answer, at],
      });
      out.push({
        id: fid,
        order: c.order,
        question: c.question,
        answer: c.answer,
        updatedAt: at,
      });
    }

    if (maeCount !== clean.length || clean.length > 0) {
      await appendAuditTx(tx, {
        tenantId: args.tenantId,
        at,
        actorKind: args.actor.kind,
        actorId: args.actor.id,
        actorName: args.actor.name,
        actorRole: args.actor.role,
        action: "TENANT_FAQ_UPDATED",
        target: args.tenantId,
        summary: `よくある質問を ${maeCount} 件から ${clean.length} 件に更新しました`,
        before: `${maeCount} 件`,
        after: `${clean.length} 件`,
        reason: "お店の設定変更",
        requestId: args.requestId,
        data: { countBefore: maeCount, countAfter: clean.length },
      });
    }

    return out;
  });
}
