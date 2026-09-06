/**
 * このお店は、いま本当に「販売を始めてよい」のか。
 *
 * ═══════════════════════════════════════════════════════
 * ★この仕組みが止めたい事故は、1つだけです
 * ═══════════════════════════════════════════════════════
 *
 *   設定が半分のまま、お客様が来てしまう。
 *
 *   具体的には、こういう状態です。
 *
 *     ・特商法の表記が空欄のまま、お金を受け取っている
 *     ・利用規約が無いまま、ポイントを売っている
 *     ・問い合わせ先が無いので、困ったお客様がどこにも連絡できない
 *     ・決済が練習用（Mock）のまま公開され、1円も払わずポイントが増える
 *     ・メールの送り口が未設定なので、本人確認メールが誰にも届かない
 *
 *   ★この5つは、どれも「動いてはいる」状態です。
 *     画面はきれいに出ますし、ボタンも押せます。
 *     エラーも出ません。だから、気づかずに公開できてしまいます。
 *
 *   気づくのは、お客様から言われたときです。
 *   そのときには、もうお金を受け取ったあとです。
 *
 * ═══════════════════════════════════════════════════════
 * ★「警告を出す」で済ませないこと
 * ═══════════════════════════════════════════════════════
 *
 *   いちばん作りたくなるのは、こういう形です。
 *
 *       「特商法が未設定です」と黄色い帯を出す。でも公開はできる。
 *
 *   ★これは、必ず無視されます。
 *     公開したい日は、たいてい急いでいる日だからです。
 *     押せるボタンは、忙しい日に必ず押されます。
 *
 *   ですので、ここは押せなくします。
 *   足りないものを、名前で挙げて、そこへ行く道だけを見せます。
 *
 * ═══════════════════════════════════════════════════════
 * ★逆に、ここで止めすぎないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「あったほうがよいもの」を必須に混ぜると、
 *   お店は、通すために適当な文字を入れるようになります。
 *   そうなると、必須という印そのものが効かなくなります。
 *
 *   ここに入れる基準は1つだけです。
 *
 *       ★無いまま公開すると、法律上の表示が欠けるか、
 *         お金かデータの事故が起きるか、どちらかであること。
 *
 *   「ロゴが無い」「ブランドカラーが既定のまま」は、
 *   見た目が寂しいだけです。ここでは止めません。
 */

import { db } from "./db";
import { getTenantSettings, FIELD_LABEL } from "./tenantSettings";
import type { SettingField } from "./tenantSettings";
import { getPointPolicy, policyBlocker } from "./pointPolicy";
import { paymentReadiness } from "./payments";
import { mailReadiness } from "./mail";

type Row = Record<string, unknown>;

/** 確認する項目の分類。画面はこの順で並べます */
export type ReadinessGroup =
  | "STORE"
  | "LEGAL"
  | "CONTACT"
  | "POINTS"
  | "CATALOG"
  | "PROVIDER";

export type ReadinessItem = {
  key: string;
  group: ReadinessGroup;
  /** 画面に出す名前 */
  label: string;
  /** 済んでいるか */
  done: boolean;
  /**
   * まだのときに、何をすればよいか。
   * ★「未設定です」だけで終わらせないこと。
   *   何を押せばよいかまで書きます。
   */
  todo: string | null;
  /** その設定へ行く管理画面のURL */
  href: string | null;
  /**
   * ★これが false なら、済んでいなくても公開は止めません。
   *   「あったほうがよい」ものです。
   */
  blocking: boolean;
};

export type LaunchReadiness = {
  items: ReadinessItem[];
  /** 公開に必要な項目のうち、済んだ数 */
  doneCount: number;
  /** 公開に必要な項目の数 */
  totalCount: number;
  /** 公開してよいか */
  canPublish: boolean;
  /** まだのもの（公開を止めているものだけ） */
  blockers: ReadinessItem[];
};

const GROUP_LABEL: Record<ReadinessGroup, string> = {
  STORE: "店舗の基本",
  LEGAL: "法定ページ",
  CONTACT: "問い合わせ",
  POINTS: "ポイント",
  CATALOG: "商品",
  PROVIDER: "外部サービス",
};

export function groupLabel(g: ReadinessGroup): string {
  return GROUP_LABEL[g];
}

/* ══════════════════════════════════════════════
   どの設定項目を、どのまとまりで見るか
   ══════════════════════════════════════════════ */

/**
 * 特商法として、必ず表示しなければならない項目。
 *
 * ★ここを1つの「特商法」という項目にまとめないこと。
 *   まとめると、何が足りないのかが画面から消えます。
 *   お店は「特商法が未完了」とだけ言われて、どこを直せばよいか分かりません。
 */
const LEGAL_FIELDS: SettingField[] = [
  "legalName",
  "representative",
  "postalCode",
  "address",
  "phone",
  "priceNote",
  "extraFeeNote",
  "paymentMethod",
  "paymentTiming",
  "deliveryTime",
  "returnsNote",
];

/**
 * 行き先のURL。
 *
 * ★ここに、実際には無いURLを書かないこと。
 *   「未設定です」と言われて押したら「そのURLはありません」と出る、
 *   というのは、何も言わないより悪いです。
 *   管理画面の入口は components/console/menu.ts の CONSOLE_BASE です。
 *   画面を増やしたときは、こちらも一緒に直してください。
 */
const SETTINGS_HREF = "/client-demo/store-setup";
const POINT_SALE_HREF = "/client-demo/point-sale";
const POINT_POLICY_HREF = "/client-demo/settings";
const GACHA_HREF = "/client-demo/gachas";

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export async function getLaunchReadiness(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LaunchReadiness> {
  const settings = await getTenantSettings(tenantId);
  const policy = await getPointPolicy(tenantId);
  const c = db();

  /* ── ポイント商品が1つ以上あるか ── */
  const pp = await c.execute({
    sql: `SELECT COUNT(*) AS n FROM point_products
           WHERE tenant_id = ? AND status = 'ACTIVE'`,
    args: [tenantId],
  });
  const pointProducts = Number((pp.rows[0] as Row)?.n ?? 0);

  /* ── ガチャが1本以上あるか ── */
  const gc = await c.execute({
    sql: `SELECT COUNT(*) AS n FROM gachas WHERE tenant_id = ?`,
    args: [tenantId],
  });
  const gachas = Number((gc.rows[0] as Row)?.n ?? 0);

  /* ── 写真の付いていないガチャが何本あるか ──
       ★ここは「お店として1本でも売れる形になっているか」を見ます。
         下書きのまま置いてある1本に写真が無いことを理由に、
         お店ぜんぶを止めるのは、やりすぎです。
         そのガチャを公開できないことは、公開のときに別に断ります
         （lib/server/gachaAdmin.ts の ensurePublishable）。 */
  const noArt = await c.execute({
    sql: `SELECT COUNT(*) AS n FROM gachas g
           WHERE g.tenant_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM gacha_stock s
                WHERE s.tenant_id = g.tenant_id
                  AND s.gacha_id = g.id
                  AND s.image_id IS NOT NULL
             )`,
    args: [tenantId],
  });
  const gachaNoArt = Number((noArt.rows[0] as Row)?.n ?? 0);
  const gachaWithArt = gachas - gachaNoArt;

  const pay = paymentReadiness(env);
  const mail = mailReadiness(env);

  const items: ReadinessItem[] = [];

  /* ── ① 店舗の基本 ── */
  items.push({
    key: "shopName",
    group: "STORE",
    label: FIELD_LABEL.shopName,
    done: !!settings.values.shopName,
    todo: settings.values.shopName
      ? null
      : "店舗設定で、お客様に見せる店舗名を入力してください。",
    href: SETTINGS_HREF,
    blocking: true,
  });

  items.push({
    key: "logoImageId",
    group: "STORE",
    label: FIELD_LABEL.logoImageId,
    done: !!settings.values.logoImageId,
    todo: settings.values.logoImageId
      ? null
      : "ロゴが未設定です。無くても公開できますが、店舗名だけの表示になります。",
    href: SETTINGS_HREF,
    /* ★止めません。見た目の話だからです */
    blocking: false,
  });

  /* ── ② 法定ページ ── */
  for (const f of LEGAL_FIELDS) {
    const v = settings.values[f];
    items.push({
      key: f,
      group: "LEGAL",
      label: FIELD_LABEL[f],
      done: !!v,
      todo: v
        ? null
        : `特定商取引法に基づく表記の「${FIELD_LABEL[f]}」が未入力です。店舗設定で入力してください。`,
      href: SETTINGS_HREF,
      blocking: true,
    });
  }

  items.push({
    key: "termsText",
    group: "LEGAL",
    label: FIELD_LABEL.termsText,
    done: !!settings.values.termsText,
    todo: settings.values.termsText
      ? null
      : "利用規約が未設定です。お客様との取り決めが無いまま販売しないでください。",
    href: SETTINGS_HREF,
    blocking: true,
  });

  items.push({
    key: "privacyText",
    group: "LEGAL",
    label: FIELD_LABEL.privacyText,
    done: !!settings.values.privacyText,
    todo: settings.values.privacyText
      ? null
      : "プライバシーポリシーが未設定です。お客様の氏名・住所をお預かりするため、必要です。",
    href: SETTINGS_HREF,
    blocking: true,
  });

  items.push({
    key: "antiqueLicense",
    group: "LEGAL",
    label: FIELD_LABEL.antiqueLicense,
    done: !!settings.values.antiqueLicense,
    /* ★これを必須にしないこと。
         中古品を扱うかどうかで、要る／要らないが変わります。
         それを決めるのは、こちらではなくお店です。 */
    todo: settings.values.antiqueLicense
      ? null
      : "中古品（開封済みカード等）を扱う場合は、古物商許可番号の表示が必要になることがあります。該当するかは、お店でご確認ください。",
    href: SETTINGS_HREF,
    blocking: false,
  });

  /* ── ③ 問い合わせ ── */
  items.push({
    key: "contactEmail",
    group: "CONTACT",
    label: FIELD_LABEL.contactEmail,
    done: !!settings.values.contactEmail,
    todo: settings.values.contactEmail
      ? null
      : "問い合わせ先メールアドレスが未設定です。困ったお客様の行き先が無い状態です。",
    href: SETTINGS_HREF,
    blocking: true,
  });

  items.push({
    key: "contactHours",
    group: "CONTACT",
    label: FIELD_LABEL.contactHours,
    done: !!settings.values.contactHours,
    todo: settings.values.contactHours
      ? null
      : "受付時間が未設定です。無くても公開できますが、返事が遅いという苦情は増えます。",
    href: SETTINGS_HREF,
    blocking: false,
  });

  /* ── ④ ポイント ── */
  items.push({
    key: "pointProducts",
    group: "POINTS",
    label: "ポイント商品",
    done: pointProducts > 0,
    todo:
      pointProducts > 0
        ? null
        : "販売中のポイント商品が1つもありません。この状態では、お客様はポイントを買えません。",
    href: POINT_SALE_HREF,
    blocking: true,
  });

  const pb = policyBlocker(policy);
  items.push({
    key: "pointPolicy",
    group: "POINTS",
    label: "ポイントの有効期限",
    done: pb === null,
    todo: pb,
    href: POINT_POLICY_HREF,
    blocking: true,
  });

  /* ── ⑤ 商品 ── */
  items.push({
    key: "gachaExists",
    group: "CATALOG",
    label: "ガチャ",
    done: gachas > 0,
    todo:
      gachas > 0 ? null : "ガチャが1本もありません。まず1本作って、検証してください。",
    href: GACHA_HREF,
    blocking: true,
  });

  items.push({
    key: "gachaArt",
    group: "CATALOG",
    label: "商品画像",
    /* 「写真の付いたガチャが1本以上あるか」を見ます。
       ★全部に付いていることを、ここでは求めません。
         下書き1本のせいで、お店ぜんぶが止まってしまうからです。 */
    done: gachaWithArt > 0,
    todo:
      gachas === 0
        ? "ガチャを作ってから、商品の写真を登録してください。"
        : gachaWithArt === 0
          ? "写真が1枚も登録されていません。お客様は中身を判断できないので、まず引かれません。"
          : gachaNoArt > 0
            ? `写真がまだ1枚も付いていないガチャが ${gachaNoArt} 本あります。そのガチャは公開できません（公開のときに、そこで止まります）。`
            : null,
    href: GACHA_HREF,
    blocking: true,
  });

  /* ── ⑥ 外部サービス ──
       ★ここは、お店ではなく、こちら（AI GACHA OS 側）の設定です。
         それでも同じ表に並べます。
         並べないと、お店は「自分の設定は全部済んだのに公開できない」と
         なって、原因が分からなくなります。 */
  /* ★ここに href を付けないこと。
       決済とメールの接続は、お店の管理画面では直せません。
       押せるボタンを出すと、お店は自分で直せると思って探し回ります。
       行き先ではなく「こちらへご連絡ください」と伝えます。 */
  const RENRAKU = "この設定は AI GACHA OS 側で行います。お手数ですが、担当者へご連絡ください。";

  const payOk = pay.canCharge && !pay.blocking;
  items.push({
    key: "paymentProvider",
    group: "PROVIDER",
    label: "決済（Payment Provider）",
    done: payOk,
    todo: payOk ? null : `${pay.message}\n${RENRAKU}`,
    href: null,
    blocking: true,
  });

  const mailOk = mail.canSend && !mail.blocking;
  items.push({
    key: "mailProvider",
    group: "PROVIDER",
    label: "メール送信（Mail Provider）",
    done: mailOk,
    todo: mailOk ? null : `${mail.message}\n${RENRAKU}`,
    href: null,
    blocking: true,
  });

  const hissu = items.filter((i) => i.blocking);
  const blockers = hissu.filter((i) => !i.done);

  return {
    items,
    doneCount: hissu.length - blockers.length,
    totalCount: hissu.length,
    canPublish: blockers.length === 0,
    blockers,
  };
}

/**
 * 公開を止める理由の文。止めないなら null。
 *
 * ★この文を、そのままお客様に見せないこと。
 *   これは管理画面（お店の方）向けの文です。
 */
export function readinessBlockMessage(r: LaunchReadiness): string | null {
  if (r.canPublish) return null;

  const namae = r.blockers.map((b) => b.label).join("／");
  return (
    `まだ販売開始できません。公開準備 ${r.doneCount}/${r.totalCount} 完了です。\n` +
    `残っているのは：${namae}\n` +
    "設定画面で埋めてから、もう一度お試しください。"
  );
}
