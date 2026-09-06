/**
 * お店の情報（会社情報・特定商取引法・利用規約・プライバシー・問い合わせ先）。
 * GET で読み、POST で保存します。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここに、こちらの会社の情報を既定値として書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   便利だからと、この入口で空欄を埋めてしまうと、こうなります。
 *
 *       お店が設定を忘れたまま、ガチャを公開する
 *         ↓
 *       そのお店の「特定商取引法に基づく表記」に、
 *       ★お店ではない会社の名前・住所・電話番号が出る
 *         ↓
 *       お客様は、そこへ返品と苦情を持っていく
 *
 *   ですので、未設定は未設定のまま返します。
 *   足りない項目は missing に入れて、画面へそのまま出してください。
 *
 * ═══════════════════════════════════════════════════════
 * ★保存は「送られてきた項目だけ」を書き換えます
 * ═══════════════════════════════════════════════════════
 *
 *   初期設定は画面をいくつかに分けて、少しずつ保存します。
 *   1画面ぶんを保存したときに、ほかの画面の入力が消えてはいけません。
 *   ですので、送られてこなかった項目には触りません。
 *   消したいときは、その項目に空文字を送ってください。
 *
 * ═══════════════════════════════════════════════════════
 * ★変えられる人を狭くします
 * ═══════════════════════════════════════════════════════
 *
 *   見る   … settings.view
 *   変える … settings.edit
 *
 *   ここは、法律上の表示と規約の本文です。
 *   書き換わると、そのままお客様に見える文章になります。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { can } from "@/lib/permissions";
import { adminActor } from "@/lib/server/adminActor";
import {
  TenantSettingsError,
  getTenantSettings,
  saveTenantSettings,
  listFaqs,
  replaceFaqs,
  FIELD_LABEL,
  SETTING_FIELDS,
  REQUIRED_FOR_PUBLISH,
} from "@/lib/server/tenantSettings";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  UNKNOWN_FIELD: 400,
  EMPTY: 400,
  TOO_LONG: 400,
  BAD_FORMAT: 400,
  BAD_INPUT: 400,
  TOO_MANY: 400,
};

/**
 * 画面へ返す形を、ここ1か所で作る。
 *
 * ★読むときと保存したときで、返す形を変えないこと。
 *   保存の返事に fields（項目の名前）を入れ忘れていたため、
 *   1回保存した瞬間に、画面の項目名が
 *   「運営法人名（販売業者）」から「legalName」に化けていました。
 *   お店の方には、これが何の欄なのか分からなくなります。
 *   canEdit も同じで、抜けると「変えられない人」扱いになります。
 *   （2026-09-06、お店側の通し確認で見つかりました）
 */
function katachi(
  requestId: string,
  role: Parameters<typeof can>[0] | null,
  settings: unknown,
  faqs: unknown,
) {
  return {
    ok: true as const,
    requestId,
    canEdit: role !== null && can(role, "settings.edit"),
    settings,
    faqs,
    /* 画面が項目名を自分で持たなくて済むように、こちらから渡します。
       ★画面側にラベルを書き写さないこと。書き写した日から、必ずずれます。 */
    fields: SETTING_FIELDS.map((f) => ({
      field: f,
      label: FIELD_LABEL[f],
      required: REQUIRED_FOR_PUBLISH.includes(f),
    })),
  };
}

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "settings.view" });
  if (!passed(gate)) return gate;

  try {
    const [settings, faqs] = await Promise.all([
      getTenantSettings(gate.session.tenantId),
      listFaqs(gate.session.tenantId),
    ]);

    return NextResponse.json(
      katachi(gate.requestId, gate.role, settings, faqs),
    );
  } catch (e) {
    return internalError(gate.requestId, "console-settings-store", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "settings.edit" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const actor = await adminActor(
      gate.session.tenantId,
      gate.session.subjectId,
      gate.role,
    );

    /* よくある質問は、まとめて入れ替えます。
       ★項目の保存と同じ回で送られてきても、別々に処理します。
         混ぜると、片方だけ失敗したときに何が残ったのか分からなくなります。 */
    let faqs = null;
    if (Array.isArray(body.faqs)) {
      faqs = await replaceFaqs({
        tenantId: gate.session.tenantId,
        items: body.faqs as { question: unknown; answer: unknown }[],
        actor,
        requestId: gate.requestId,
      });
    }

    let settings = null;
    const patch = body.patch;
    if (patch !== undefined && patch !== null && typeof patch === "object") {
      settings = await saveTenantSettings({
        tenantId: gate.session.tenantId,
        patch: patch as Record<string, unknown>,
        actor,
        requestId: gate.requestId,
      });
    }

    if (settings === null && faqs === null) {
      return NextResponse.json(
        {
          ok: false,
          code: "EMPTY",
          message: "変更する内容がありません。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      katachi(
        gate.requestId,
        gate.role,
        settings ?? (await getTenantSettings(gate.session.tenantId)),
        faqs ?? (await listFaqs(gate.session.tenantId)),
      ),
    );
  } catch (e) {
    if (e instanceof TenantSettingsError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          requestId: gate.requestId,
        },
        { status: STATUS[e.code] ?? 400 },
      );
    }
    return internalError(gate.requestId, "console-settings-store-save", e);
  }
}
