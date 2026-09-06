/**
 * 「お店が自分で開店できること」を、機械で固定する試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   この仕組みは、複数のお店に売ります。
 *   ですから、こちらが1軒ずつ設定してあげる形になった時点で、
 *   商品ではなく受託になります。
 *
 *   そうならないために、次の3つを機械で固定します。
 *
 *     1) 店舗の設定は、送った項目だけが変わること
 *        （1画面を保存したら、まだ開いていない画面の入力が
 *          空で消えていた、が起きないこと）
 *
 *     2) 法定表示（特商法・規約・プライバシー）に、
 *        こちらの文例が1文字も入っていないこと
 *        ★入れた瞬間、こちらがそのお店の法的表示を代筆したことになります
 *
 *     3) 埋まっていないうちは「まだ販売開始できません」になること
 *        （画面に「準備できています」と出ているのに
 *          公開ボタンだけ断られる、という食い違いを作らないこと）
 *
 *   そして、棚（カテゴリ）については、
 *
 *     4) 棚の名前が、こちらのコードの中に1つも無いこと
 *     5) 棚を消しても、中のガチャが消えないこと
 *     6) よその会社の棚を、自分のガチャに付けられないこと
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resetDbForTests } from "../lib/server/db";
import { createTenant, createGacha } from "../lib/server/seed";
import {
  SETTING_FIELDS,
  REQUIRED_FOR_PUBLISH,
  FIELD_LABEL,
  TenantSettingsError,
  getTenantSettings,
  saveTenantSettings,
  listFaqs,
  replaceFaqs,
  type SettingField,
} from "../lib/server/tenantSettings";
import {
  CategoryError,
  CATEGORY_MAX_COUNT,
  PER_GACHA_MAX,
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  getGachaCategories,
  setGachaCategories,
} from "../lib/server/gachaCategories";
import { getLaunchReadiness, readinessBlockMessage } from "../lib/server/launchReadiness";
import type { Actor } from "../lib/server/orders";

after(async () => {
  await resetDbForTests();
});

const ROOT = join(__dirname, "..");

const ACTOR: Actor = {
  kind: "ADMIN",
  id: "adm_test",
  name: "試験の担当者",
  role: "SUPER_ADMIN",
};

let n = 0;
/** 試験ごとに、まっさらな会社を1つ作る */
async function tenant(): Promise<string> {
  n += 1;
  return createTenant({ code: `SETUP${n}`, name: `設定試験${n}株式会社` });
}

/* ══════════════════════════════════════════════
   1) 送った項目だけが変わる
   ══════════════════════════════════════════════ */

test("店舗設定：送っていない項目は、保存しても消えない", async () => {
  const t = await tenant();

  await saveTenantSettings({
    tenantId: t,
    patch: { shopName: "テスト店", legalName: "テスト法人", phone: "00-0000-0000" },
    actor: ACTOR,
    requestId: "req1",
  });

  /* 別の画面のつもりで、1項目だけ保存する */
  const after2 = await saveTenantSettings({
    tenantId: t,
    patch: { address: "どこかの住所" },
    actor: ACTOR,
    requestId: "req2",
  });

  assert.equal(after2.values.shopName, "テスト店");
  assert.equal(after2.values.legalName, "テスト法人");
  assert.equal(after2.values.phone, "00-0000-0000");
  assert.equal(after2.values.address, "どこかの住所");
});

test("店舗設定：空文字を送ると、未設定（null）に戻る", async () => {
  const t = await tenant();

  await saveTenantSettings({
    tenantId: t,
    patch: { shopName: "消される店" },
    actor: ACTOR,
    requestId: "req1",
  });
  const r = await saveTenantSettings({
    tenantId: t,
    patch: { shopName: "" },
    actor: ACTOR,
    requestId: "req2",
  });

  /* ★空文字のまま残さないこと。
       残すと「設定済み」と数えられて、空欄のまま公開できてしまいます */
  assert.equal(r.values.shopName, null);
});

test("店舗設定：知らない項目名は、黙って捨てずに断る", async () => {
  const t = await tenant();
  await assert.rejects(
    () =>
      saveTenantSettings({
        tenantId: t,
        patch: { shopNmae: "打ち間違い" } as Record<string, unknown>,
        actor: ACTOR,
        requestId: "req1",
      }),
    (e: unknown) => e instanceof TenantSettingsError,
  );
});

test("店舗設定：まだ読んでいない会社は、全部 null で complete=false", async () => {
  const t = await tenant();
  const s = await getTenantSettings(t);

  for (const f of SETTING_FIELDS) {
    assert.equal(s.values[f], null, `${f} は未設定のはずです`);
  }
  assert.equal(s.complete, false);
  assert.equal(s.missing.length, REQUIRED_FOR_PUBLISH.length);
});

test("店舗設定：未設定の項目名は、必ず日本語の見せる名前で返る", async () => {
  const t = await tenant();
  const s = await getTenantSettings(t);

  for (const m of s.missing) {
    assert.equal(m.label, FIELD_LABEL[m.field as SettingField]);
    /* ★英語の列名がそのまま出ないこと。
         「legalName が未設定です」と出されても、お店には分かりません */
    assert.notEqual(m.label, m.field);
  }
});

/* ══════════════════════════════════════════════
   2) 法定表示に、こちらの文例を入れない
   ══════════════════════════════════════════════ */

test("法定表示：規約・プライバシーの初期値は空である（文例を入れない）", async () => {
  const t = await tenant();
  const s = await getTenantSettings(t);

  assert.equal(s.values.termsText, null);
  assert.equal(s.values.privacyText, null);
  assert.equal(s.values.returnsNote, null);
  assert.equal(s.values.paymentMethod, null);
});

test("法定表示：サーバー側のコードに、規約やプライバシーの文例が書かれていない", () => {
  const files = [
    "lib/server/tenantSettings.ts",
    "lib/server/launchReadiness.ts",
    "components/console/screens/StoreSetupScreen.tsx",
  ];

  /*
   * ★この見張りを外さないこと。
   *   「空欄だと格好が付かないから」という理由で、
   *   一度でも文例を初期値に入れると、
   *   その日から、こちらが全店の法的表示を代筆したことになります。
   *
   *   ここでは、法律文書に必ず出てくる言い回しを探します。
   *   説明文（「〜を書いてください」）とは形が違うので、
   *   案内は残したまま、文例だけを止められます。
   */
  const NG = [
    "本規約は",
    "第1条",
    "第一条",
    "当社は、個人情報",
    "本サービスの利用に関して",
    "以下のとおり定めます",
    "これに同意したものとみなします",
  ];

  for (const f of files) {
    const text = readFileSync(join(ROOT, f), "utf8");
    for (const ng of NG) {
      assert.ok(
        !text.includes(ng),
        `${f} に法律文書の文例らしい記述があります：「${ng}」`,
      );
    }
  }
});

/* ══════════════════════════════════════════════
   3) 埋まるまでは「まだ販売開始できません」
   ══════════════════════════════════════════════ */

/**
 * 必須の店舗設定を、ぜんぶ埋める。
 *
 * ★中身は試験用の当たり障りのない文字です。
 *   ここに、それらしい規約や特商法の文を書かないこと。
 *   試験に書いたものは、いずれ「使える文例」として
 *   本体へ持ち込まれます。
 *
 * ★形が決まっている項目（メール・郵便番号・電話）は、
 *   形の合うものを入れます。合わない値は保存の時点で断られます
 *   （それ自体は、そうあるべき動きです）。
 */
const KATA: Partial<Record<SettingField, string>> = {
  contactEmail: "test@example.test",
  postalCode: "000-0000",
  phone: "00-0000-0000",
};

async function fillRequired(tenantId: string) {
  const patch: Record<string, string> = {};
  for (const f of REQUIRED_FOR_PUBLISH) {
    patch[f] = KATA[f] ?? `試験用の${FIELD_LABEL[f]}`;
  }
  await saveTenantSettings({
    tenantId,
    patch,
    actor: ACTOR,
    requestId: "fill",
  });
}

test("公開準備：何も設定していない会社は canPublish=false で、止めている理由が出る", async () => {
  const t = await tenant();
  const r = await getLaunchReadiness(t);

  assert.equal(r.canPublish, false);
  assert.ok(r.blockers.length > 0);
  assert.ok(r.totalCount > 0);
  assert.ok(r.doneCount < r.totalCount);

  const msg = readinessBlockMessage(r);
  assert.ok(msg !== null);
  assert.ok(msg.includes("販売"), "止める文には、販売開始できないことが書かれていること");
});

test("公開準備：数え方は items と一致する（画面用の数字を別に作らない）", async () => {
  const t = await tenant();
  await fillRequired(t);
  const r = await getLaunchReadiness(t);

  /*
   * ★「○/○ 完了」は、公開を止める項目だけで数えること。
   *   止めない項目（あると良いだけのもの）まで分母に入れると、
   *   全部埋めないと 100% にならないので、
   *   お店は「まだ準備できていない」と受け取ります。
   *   実際には公開できる状態なのに、公開しません。
   */
  const hissu = r.items.filter((i) => i.blocking);
  assert.equal(r.totalCount, hissu.length);
  assert.equal(r.doneCount, hissu.filter((i) => i.done).length);
  assert.equal(
    r.blockers.length,
    r.items.filter((i) => i.blocking && !i.done).length,
  );
  /* ★canPublish は「止める項目が0件」と同じ意味であること。
       別々に決めると、○/○ が全部済みなのに公開できない日が来ます */
  assert.equal(r.canPublish, r.blockers.length === 0);
});

test("公開準備：店舗設定を埋めると、その項目だけが「済」に変わる", async () => {
  const t = await tenant();
  const mae = await getLaunchReadiness(t);
  await fillRequired(t);
  const ato = await getLaunchReadiness(t);

  assert.ok(ato.doneCount > mae.doneCount);
  /* まだガチャも決済も無いので、公開はできないまま */
  assert.equal(ato.canPublish, false);
});

test("公開準備：案内のリンク先は、実在する管理画面のURLである", async () => {
  const t = await tenant();
  const r = await getLaunchReadiness(t);

  const menu = readFileSync(join(ROOT, "components/console/menu.ts"), "utf8");

  for (const item of r.items) {
    if (item.href === null) continue;
    /* ★「未設定です」と言われて押したら「そのURLはありません」と出るのは、
         何も言わないより悪いです */
    assert.ok(
      item.href.startsWith("/client-demo/"),
      `${item.key} の行き先が管理画面の外です：${item.href}`,
    );
    const slug = item.href.slice("/client-demo/".length);
    assert.ok(
      menu.includes(`"${slug}"`),
      `${item.key} の行き先 ${item.href} は、menu.ts にありません`,
    );
  }
});

test("公開準備：決済とメールの行には、お店が押せるリンクを出さない", async () => {
  const t = await tenant();
  const r = await getLaunchReadiness(t);

  for (const key of ["paymentProvider", "mailProvider"]) {
    const item = r.items.find((i) => i.key === key);
    assert.ok(item, `${key} の行が見つかりません`);
    /* この2つは、お店の管理画面では直せません。
       押せるボタンを出すと、お店は自分で直せると思って探し回ります */
    assert.equal(item.href, null);
    assert.equal(item.blocking, true);
  }
});

/* ══════════════════════════════════════════════
   よくある質問
   ══════════════════════════════════════════════ */

test("よくある質問：まとめて入れ替えると、並び順もそのとおりになる", async () => {
  const t = await tenant();

  await replaceFaqs({
    tenantId: t,
    items: [
      { question: "質問A", answer: "答えA" },
      { question: "質問B", answer: "答えB" },
    ],
    actor: ACTOR,
    requestId: "faq1",
  });

  const first = await listFaqs(t);
  assert.deepEqual(
    first.map((f) => f.question),
    ["質問A", "質問B"],
  );

  await replaceFaqs({
    tenantId: t,
    items: [
      { question: "質問B", answer: "答えB" },
      { question: "質問A", answer: "答えA" },
      { question: "質問C", answer: "答えC" },
    ],
    actor: ACTOR,
    requestId: "faq2",
  });

  const second = await listFaqs(t);
  assert.deepEqual(
    second.map((f) => f.question),
    ["質問B", "質問A", "質問C"],
  );
});

test("よくある質問：空の行は断る（画面に空欄が出てしまうため）", async () => {
  const t = await tenant();
  await assert.rejects(
    () =>
      replaceFaqs({
        tenantId: t,
        items: [{ question: "質問だけ", answer: "  " }],
        actor: ACTOR,
        requestId: "faq3",
      }),
    (e: unknown) => e instanceof TenantSettingsError,
  );
});

/* ══════════════════════════════════════════════
   4〜6) 棚（カテゴリ）
   ══════════════════════════════════════════════ */

test("カテゴリ：作った会社は、最初は棚が0個である（既定の棚を配らない）", async () => {
  const t = await tenant();
  const list = await listCategories(t);
  /* ★「ポケモン／ワンピース」などを最初から入れないこと。
       時計を売るお店が来た日に、こちらへ連絡が来ます */
  assert.deepEqual(list, []);
});

test("カテゴリ：コードの中に、特定の棚の名前が書かれていない", () => {
  const files = [
    "lib/server/gachaCategories.ts",
    "app/api/console/categories/route.ts",
    "components/console/CategoryPanel.tsx",
    "components/console/GachaCategoryPicker.tsx",
  ];

  /*
   * ★この見張りを外さないこと。
   *   ここに商材の名前が入った瞬間、この仕組みは
   *   「その商材を売る店だけの受託システム」になります。
   *
   *   ただし説明文で例を挙げること自体は禁じません。
   *   禁じるのは、コードとして持つことです。
   *   ですので、引用符で囲まれた文字列だけを見ます。
   */
  const NG = ["ポケモン", "ワンピース", "スニーカー", "遊戯王", "その他"];

  for (const f of files) {
    const text = readFileSync(join(ROOT, f), "utf8");
    for (const ng of NG) {
      assert.ok(
        !text.includes(`"${ng}"`) && !text.includes(`'${ng}'`),
        `${f} に、棚の名前が固定で書かれています：「${ng}」`,
      );
    }
  }
});

test("カテゴリ：同じ名前は作れない", async () => {
  const t = await tenant();
  await createCategory({ tenantId: t, name: "たな1", actor: ACTOR, requestId: "c1" });
  await assert.rejects(
    () => createCategory({ tenantId: t, name: "たな1", actor: ACTOR, requestId: "c2" }),
    (e: unknown) => e instanceof CategoryError && e.code === "DUPLICATE",
  );
});

test("カテゴリ：上限を超えて作れない", async () => {
  const t = await tenant();
  for (let i = 0; i < CATEGORY_MAX_COUNT; i += 1) {
    await createCategory({
      tenantId: t,
      name: `たな${i}`,
      actor: ACTOR,
      requestId: `c${i}`,
    });
  }
  await assert.rejects(
    () => createCategory({ tenantId: t, name: "あふれる棚", actor: ACTOR, requestId: "cx" }),
    (e: unknown) => e instanceof CategoryError && e.code === "TOO_MANY",
  );
});

test("カテゴリ：名前を変えても、入っているガチャは外れない", async () => {
  const t = await tenant();
  const cat = await createCategory({
    tenantId: t,
    name: "まえの名前",
    actor: ACTOR,
    requestId: "c1",
  });
  const g = await createGacha({
    tenantId: t,
    title: "試験ガチャ",
    price: 500,
    total: 100,
    designedRtp: 0.8,
  });
  await setGachaCategories({
    tenantId: t,
    gachaId: g,
    categoryIds: [cat.id],
    actor: ACTOR,
    requestId: "s1",
  });

  await renameCategory({
    tenantId: t,
    categoryId: cat.id,
    name: "あとの名前",
    actor: ACTOR,
    requestId: "r1",
  });

  assert.deepEqual(await getGachaCategories(t, g), [cat.id]);
});

test("カテゴリ：棚を消しても、ガチャは消えない（つながりだけが消える）", async () => {
  const t = await tenant();
  const cat = await createCategory({
    tenantId: t,
    name: "消す棚",
    actor: ACTOR,
    requestId: "c1",
  });
  const g = await createGacha({
    tenantId: t,
    title: "消えないガチャ",
    price: 500,
    total: 100,
    designedRtp: 0.8,
  });
  await setGachaCategories({
    tenantId: t,
    gachaId: g,
    categoryIds: [cat.id],
    actor: ACTOR,
    requestId: "s1",
  });

  const r = await deleteCategory({
    tenantId: t,
    categoryId: cat.id,
    actor: ACTOR,
    requestId: "d1",
  });

  /* ★何本が棚なしになったかを、必ず数えて返すこと。
       黙って消すと「ガチャも消えた」と思われます */
  assert.equal(r.removedLinks, 1);
  assert.deepEqual(await getGachaCategories(t, g), []);

  /* ガチャ本体は残っている */
  const list = await listCategories(t);
  assert.deepEqual(list, []);
  const still = await getGachaCategories(t, g);
  assert.deepEqual(still, []);
});

test("カテゴリ：1本のガチャに付けられる棚には上限がある", async () => {
  const t = await tenant();
  const ids: string[] = [];
  for (let i = 0; i <= PER_GACHA_MAX; i += 1) {
    const c = await createCategory({
      tenantId: t,
      name: `たな${i}`,
      actor: ACTOR,
      requestId: `c${i}`,
    });
    ids.push(c.id);
  }
  const g = await createGacha({
    tenantId: t,
    title: "欲張りガチャ",
    price: 500,
    total: 100,
    designedRtp: 0.8,
  });

  await assert.rejects(
    () =>
      setGachaCategories({
        tenantId: t,
        gachaId: g,
        categoryIds: ids,
        actor: ACTOR,
        requestId: "s1",
      }),
    (e: unknown) => e instanceof CategoryError && e.code === "TOO_MANY",
  );
});

test("カテゴリ：よその会社の棚は、自分のガチャに付けられない", async () => {
  const a = await tenant();
  const b = await tenant();

  const yoso = await createCategory({
    tenantId: b,
    name: "よその棚",
    actor: ACTOR,
    requestId: "c1",
  });
  const g = await createGacha({
    tenantId: a,
    title: "うちのガチャ",
    price: 500,
    total: 100,
    designedRtp: 0.8,
  });

  /*
   * ★ここを通してはいけません。
   *   IDを打ち替えるだけで、自分のガチャを
   *   よその会社の棚に置けてしまいます。
   */
  await assert.rejects(
    () =>
      setGachaCategories({
        tenantId: a,
        gachaId: g,
        categoryIds: [yoso.id],
        actor: ACTOR,
        requestId: "s1",
      }),
    (e: unknown) => e instanceof CategoryError,
  );

  assert.deepEqual(await getGachaCategories(a, g), []);
});

test("カテゴリ：一覧は、よその会社のものを1件も含まない", async () => {
  const a = await tenant();
  const b = await tenant();

  await createCategory({ tenantId: a, name: "A社の棚", actor: ACTOR, requestId: "c1" });
  await createCategory({ tenantId: b, name: "B社の棚", actor: ACTOR, requestId: "c2" });

  const la = await listCategories(a);
  const lb = await listCategories(b);

  assert.deepEqual(la.map((c) => c.name), ["A社の棚"]);
  assert.deepEqual(lb.map((c) => c.name), ["B社の棚"]);
});

test("カテゴリ：棚に入っているガチャの本数を数えて返す", async () => {
  const t = await tenant();
  const cat = await createCategory({
    tenantId: t,
    name: "数える棚",
    actor: ACTOR,
    requestId: "c1",
  });

  for (let i = 0; i < 3; i += 1) {
    const g = await createGacha({
      tenantId: t,
      title: `ガチャ${i}`,
      price: 500,
      total: 100,
      designedRtp: 0.8,
    });
    await setGachaCategories({
      tenantId: t,
      gachaId: g,
      categoryIds: [cat.id],
      actor: ACTOR,
      requestId: `s${i}`,
    });
  }

  const list = await listCategories(t);
  assert.equal(list[0]?.gachaCount, 3);
});
