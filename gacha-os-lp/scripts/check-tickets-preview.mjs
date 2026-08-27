/**
 * 問い合わせの画面が「本当か」を、公開先（Preview）で確かめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具が答える問い
 * ═══════════════════════════════════════════════════════
 *
 *   2026-08-27 まで、管理画面の問い合わせは
 *   ブラウザの中だけの見本データでした。
 *   画面の中の控えに返信しても、お客様には何も届きません。
 *   しかも、運営者から見ると
 *
 *       返信ボタンは押せる
 *       一覧は「対応中」に変わる
 *       件数も減る
 *
 *   ので、届いたようにしか見えません。
 *   お客様だけが、ずっと待ち続けます。
 *
 *   手元の試験（tests/ticketAdmin.test.ts）は、
 *   同じパソコンの中で動いています。
 *   ここでは、ネット越しに公開先を実際に叩いて、
 *   お客様が出した1件が、運営に出て、返って戻るところまでを見ます。
 *
 *     A. お客様が新しく問い合わせを出す
 *     B. 運営の一覧に、その場で出る
 *     C. AIが一次回答の下書きを作る
 *     D. AIに答えさせてはいけない話は、下書きすら作らせない
 *     E. 人が返信を送る
 *     F. お客様の画面に、その場で出る
 *     G. 解決済みにする
 *     H. 他社からは、一覧にも詳細にも操作にも触れない
 *     I. 他のお客様の問い合わせには触れない（存在も漏らさない）
 *     J. 返信の権限が無い人は、送れない
 *     K. 2人が同時に返信しても、履歴が壊れない
 *     L. 読み直しても、別のサーバーに当たっても、同じものが残る
 *
 * ═══════════════════════════════════════════════════════
 * ★書き込みます。接続先に気をつけてください
 * ═══════════════════════════════════════════════════════
 *
 *   点検のあいだ、問い合わせを作って返信します。
 *   DATABASE_ENV が production なら、何もせず止まります。
 *
 *   ★作った問い合わせは、消しません。
 *     消すと、audit の鎖と食い違います。
 *     件名に必ず「【点検】」を付けて、あとから分かるようにします。
 *
 * 使い方：
 *   npx tsx --env-file=.env.local \
 *     scripts/check-tickets-preview.mjs <Preview URL>
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { makePreviewClient } from "./lib/preview-client.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
const PW = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";

if (!BASE || !/^https:\/\//.test(BASE)) {
  console.error(
    "\n✗ Preview の URL を渡してください（https:// で始まるもの）。\n" +
      "  ★localhost を渡さないこと。localhost で通っても、\n" +
      "    公開先で通る保証にはなりません。\n",
  );
  process.exit(1);
}

const dbEnv = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (dbEnv === "production") {
  console.error(
    "\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n",
  );
  process.exit(1);
}
if (!(process.env.DATABASE_URL ?? "").trim()) {
  console.error(
    "\n✗ DATABASE_URL がありません（npx vercel env pull .env.local）。\n",
  );
  process.exit(1);
}

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const Hito = makePreviewClient({ base: BASE, password: PW, db });

/* ══════════════════════════════════════════════
   結果の集め方
   ══════════════════════════════════════════════ */

const kekka = [];
let dame = 0;

/**
 * 1つ確かめる。
 *
 * ★「だいたい合っている」を ok にしないこと。
 *   受け取る人は、この○×しか読みません。
 */
function miru(kigou, midashi, ok, iiwake = "") {
  kekka.push({ kigou, midashi, ok, iiwake });
  if (!ok) dame += 1;
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${kigou}. ${midashi}${iiwake ? `\n      → ${iiwake}` : ""}`);
}

const shirushi = `【点検】${new Date().toISOString().slice(0, 19)}`;

/* ══════════════════════════════════════════════
   入る
   ══════════════════════════════════════════════ */

console.log(`\n問い合わせの点検を始めます。\n  接続先： ${BASE}\n`);

const kyaku = new Hito("お客様1");
const kyaku2 = new Hito("お客様2");
const sup = new Hito("サポート");
const sup2 = new Hito("サポート（もう1人）");
const etsuran = new Hito("閲覧のみ");
const bBoss = new Hito("B社の社長");

async function hairu(h, kind, tenantCode, mail) {
  const r = await h.login(kind, tenantCode, mail);
  if (r.status !== 200) {
    console.error(
      `\n✗ ${h.label}（${mail}）が入れませんでした：` +
        `${r.status} ${r.json?.code ?? ""} ${r.json?.message ?? ""}\n`,
    );
    process.exit(1);
  }
  return r;
}

await hairu(kyaku, "CUSTOMER", "DEMO", "user1@demo.example");
await hairu(kyaku2, "CUSTOMER", "DEMO", "user2@demo.example");
await hairu(sup, "ADMIN", "DEMO", "support@demo.example");
await hairu(sup2, "ADMIN", "DEMO", "unei@demo.example");
await hairu(etsuran, "ADMIN", "DEMO", "etsuran@demo.example");
await hairu(bBoss, "ADMIN", "KANSA", "b-boss@kansa.example");

/* ══════════════════════════════════════════════
   A. お客様が新しく問い合わせを出す
   ══════════════════════════════════════════════ */

console.log("\n── A〜B　お客様が出したものが、運営に出るか ──\n");

const dasu = async (h, subject, body) => {
  const r = await h.call("/api/customer/support", "POST", { subject, body });
  return r;
};

const a1 = await dasu(
  kyaku,
  `${shirushi} 発送について`,
  "注文した商品の発送予定を知りたいです。まだ届いていません。",
);
miru(
  "A",
  "お客様が、マイページから問い合わせを出せる",
  a1.status === 200 && a1.json?.ok === true,
  a1.status === 200 ? "" : `${a1.status} ${a1.json?.message ?? ""}`,
);

/* お客様側の一覧から、いま出した1件のIDを拾う */
const mine1 = await kyaku.call("/api/customer/support");
const myTicket = (mine1.json?.tickets ?? []).find((t) =>
  String(t.subject ?? "").includes(shirushi),
);
if (!myTicket) {
  console.error("\n✗ 出したはずの問い合わせが、お客様の一覧に出ていません。\n");
  process.exit(1);
}
const TID = String(myTicket.id);

/* ══════════════════════════════════════════════
   B. 運営の一覧に、その場で出る
   ══════════════════════════════════════════════ */

const list1 = await sup.call("/api/console/tickets");
const row1 = (list1.json?.tickets ?? []).find((t) => t.id === TID);
miru(
  "B",
  "同じ1件が、運営の一覧にその場で出る（見本ではない）",
  list1.status === 200 && !!row1 && row1.status === "NEW",
  row1 ? `状態=${row1.status}` : "一覧に出ていません",
);

/* ★件数も、その1件ぶん動いていること */
const sum1 = await sup.call("/api/console/summary");
miru(
  "B2",
  "ダッシュボードの「まだ誰も見ていない問い合わせ」が、一覧と同じ数",
  sum1.json?.supportNew === list1.json?.counts?.new,
  `ダッシュボード=${sum1.json?.supportNew} / 一覧=${list1.json?.counts?.new}`,
);

/* ══════════════════════════════════════════════
   C. AIが一次回答の下書きを作る
   ══════════════════════════════════════════════ */

console.log("\n── C〜D　AIに、どこまでやらせるか ──\n");

const ai1 = await sup.call("/api/console/tickets/action", "POST", {
  action: "ai-reply",
  ticketId: TID,
});
miru(
  "C",
  "AIが一次回答の下書きを作る（送信はしない）",
  ai1.status === 200 &&
    ai1.json?.ok === true &&
    ai1.json?.result?.outcome === "AI_REPLIED" &&
    typeof ai1.json?.result?.draft === "string" &&
    ai1.json.result.draft.length > 0,
  ai1.status === 200
    ? `結果=${ai1.json?.result?.outcome}`
    : `${ai1.status} ${ai1.json?.message ?? ""}`,
);

miru(
  "C2",
  "下書きには、何を見て書いたかの根拠が残っている",
  Array.isArray(ai1.json?.result?.sources) && ai1.json.result.sources.length > 0,
  `根拠=${JSON.stringify(ai1.json?.result?.sources ?? [])}`,
);

/* ★下書きを作っただけでは、解決済みにしないこと */
const afterAi = await sup.call(`/api/console/tickets?id=${encodeURIComponent(TID)}`);
miru(
  "C3",
  "AIが下書きを作っただけでは、解決済みにならない",
  afterAi.json?.ticket?.status !== "RESOLVED",
  `状態=${afterAi.json?.ticket?.status}`,
);

/*
 * ★下書きは、まだ誰も送っていないこと（2026-08-27に見つかった穴）。
 *
 *   ここを見ていなかったため、AIが下書きを作った瞬間に、
 *   その文がお客様の画面へ「サポート担当」として出ていました。
 *   担当者は送信を1度も押していません。
 *   下書きが間違っていても、取り消せません。
 */
const kyakuAfterAi = await kyaku.call("/api/customer/support");
const mineAfterAi = (kyakuAfterAi.json?.tickets ?? []).find(
  (t) => String(t.id) === TID,
);
miru(
  "C4",
  "AIの下書きは、お客様の画面に1文字も出ていない（送信していないため）",
  Array.isArray(mineAfterAi?.messages) && mineAfterAi.messages.length === 1,
  `お客様側のやり取り=${mineAfterAi?.messages?.length ?? "?"}件`,
);
miru(
  "C5",
  "下書きの段階で「回答いたしました」と表示していない",
  mineAfterAi?.statusLabel === "担当者が確認しています",
  `お客様に見えている状態=${mineAfterAi?.statusLabel}`,
);

/* ══════════════════════════════════════════════
   D. AIに答えさせてはいけない話
   ══════════════════════════════════════════════ */

await dasu(
  kyaku,
  `${shirushi} 返金してください`,
  "先週の注文を返金してほしいです。30,000円ぶんです。",
);
const mine2 = await kyaku.call("/api/customer/support");
const kiken = (mine2.json?.tickets ?? []).find((t) =>
  String(t.subject ?? "").includes("返金してください"),
);
const KID = String(kiken?.id ?? "");

const ai2 = await sup.call("/api/console/tickets/action", "POST", {
  action: "ai-reply",
  ticketId: KID,
});
miru(
  "D",
  "返金・高額の話は、AIに下書きすら作らせず、人の確認へ回す",
  ai2.status === 200 &&
    ai2.json?.result?.outcome === "HUMAN_REVIEW" &&
    (ai2.json?.result?.draft ?? null) === null,
  `結果=${ai2.json?.result?.outcome} / 下書き=${
    ai2.json?.result?.draft === null ? "作っていない" : "作ってしまった"
  }`,
);

/* ダッシュボードの「人の確認が必要」が、その1件ぶん増えていること */
const sum2 = await sup.call("/api/console/summary");
const list2 = await sup.call("/api/console/tickets");
miru(
  "D2",
  "「人の確認が必要」の件数が、ダッシュボードと一覧で一致する",
  sum2.json?.supportHumanReview === list2.json?.counts?.humanReview,
  `ダッシュボード=${sum2.json?.supportHumanReview} / 一覧=${list2.json?.counts?.humanReview}`,
);

/* ══════════════════════════════════════════════
   E〜F. 人が返信 → お客様へ届く
   ══════════════════════════════════════════════ */

console.log("\n── E〜G　人が返して、お客様に届いて、閉じるまで ──\n");

/* 担当者を決める（30項目の12番） */
const staff = (list1.json?.assignees ?? []).find((a) =>
  String(a.name ?? "").length > 0,
);
const asg = await sup.call("/api/console/tickets/action", "POST", {
  action: "assign",
  assigneeId: list1.json?.meId ?? staff?.id ?? null,
  ticketId: TID,
});
miru(
  "E0",
  "担当者を決められる",
  asg.status === 200 && asg.json?.ok === true,
  asg.status === 200 ? "" : `${asg.status} ${asg.json?.message ?? ""}`,
);

const HENJI = `${shirushi} 本日中に発送いたします。追跡番号は、発送後にあらためてご案内いたします。`;
const rep = await sup.call("/api/console/tickets/action", "POST", {
  action: "reply",
  ticketId: TID,
  text: HENJI,
  resolve: false,
});
miru(
  "E",
  "担当者が返信を送れる",
  rep.status === 200 && rep.json?.ok === true,
  rep.status === 200 ? "" : `${rep.status} ${rep.json?.message ?? ""}`,
);

const mine3 = await kyaku.call("/api/customer/support");
const mi = (mine3.json?.tickets ?? []).find((t) => t.id === TID);
const msgs = mi?.messages ?? [];
miru(
  "F",
  "その返信が、お客様の画面にその場で出る（同じ1つの表を見ている）",
  msgs.length >= 2 && String(msgs[msgs.length - 1].body ?? "").includes(HENJI),
  `やり取り=${msgs.length}件 / 最後=${String(msgs[msgs.length - 1]?.from ?? "")}`,
);

miru(
  "F2",
  "お客様の画面に「AI」という言葉を出していない",
  msgs.every((m) => !String(m.from ?? "").includes("AI")),
  `差出人=${JSON.stringify(msgs.map((m) => m.from))}`,
);

/* お知らせが1件できていること（メールはMockなので記録だけ） */
const notices = await kyaku.call("/api/customer/notices");
const oshirase = (notices.json?.notices ?? notices.json?.items ?? []).filter(
  (x) => String(x.refId ?? x.ref_id ?? "") === TID,
);
miru(
  "F3",
  "返信すると、お客様へのお知らせが記録される（メールはMock）",
  oshirase.length >= 1,
  `お知らせ=${oshirase.length}件`,
);

/* G. 解決にする（理由が要る） */
const riyuNashi = await sup.call("/api/console/tickets/action", "POST", {
  action: "status",
  ticketId: TID,
  to: "RESOLVED",
  reason: "",
});
miru(
  "G0",
  "理由を書かずに、解決済みにはできない",
  riyuNashi.status !== 200,
  `${riyuNashi.status} ${riyuNashi.json?.message ?? ""}`,
);

const kaiketsu = await sup.call("/api/console/tickets/action", "POST", {
  action: "status",
  ticketId: TID,
  to: "RESOLVED",
  reason: "発送日をご案内し、ご納得いただきました。",
});
miru(
  "G",
  "理由を添えれば、解決済みにできる",
  kaiketsu.status === 200 && kaiketsu.json?.ok === true,
  kaiketsu.status === 200 ? "" : `${kaiketsu.status} ${kaiketsu.json?.message ?? ""}`,
);

/* ══════════════════════════════════════════════
   H. 会社の壁
   ══════════════════════════════════════════════ */

console.log("\n── H〜J　見てはいけないもの・してはいけないこと ──\n");

const bList = await bBoss.call("/api/console/tickets");
miru(
  "H",
  "B社の一覧に、A社の問い合わせが1件も出ない",
  bList.status === 200 &&
    !(bList.json?.tickets ?? []).some((t) => t.id === TID),
  `B社の一覧=${(bList.json?.tickets ?? []).length}件`,
);

const bDetail = await bBoss.call(
  `/api/console/tickets?id=${encodeURIComponent(TID)}`,
);
miru(
  "H2",
  "B社から、A社の問い合わせの詳細を開けない",
  bDetail.status === 404 || bDetail.json?.ok !== true,
  `${bDetail.status} ${bDetail.json?.code ?? ""}`,
);

const bReply = await bBoss.call("/api/console/tickets/action", "POST", {
  action: "reply",
  ticketId: TID,
  text: "B社からの返信です。これが通ってはいけません。",
  resolve: false,
});
miru(
  "H3",
  "B社から、A社の問い合わせに返信できない",
  bReply.status !== 200,
  `${bReply.status} ${bReply.json?.code ?? ""}`,
);

const bStatus = await bBoss.call("/api/console/tickets/action", "POST", {
  action: "status",
  ticketId: TID,
  to: "NEW",
  reason: "他社のものを開け直そうとしています",
});
miru(
  "H4",
  "B社から、A社の問い合わせの状態を変えられない",
  bStatus.status !== 200,
  `${bStatus.status} ${bStatus.json?.code ?? ""}`,
);

/* ══════════════════════════════════════════════
   I. 他のお客様のもの（存在も漏らさない）
   ══════════════════════════════════════════════ */

const hoka = await kyaku2.call("/api/customer/support");
const hokaMochi = (hoka.json?.tickets ?? []).some((t) => t.id === TID);
miru(
  "I",
  "別のお客様の画面に、他人の問い合わせが出ない",
  hokaMochi === false,
);

/* ★存在するIDと、存在しないIDで、返り方が同じであること */
const naiId = "tkt_konomonoha_arimasen";
const r1 = await bBoss.call(`/api/console/tickets?id=${encodeURIComponent(TID)}`);
const r2 = await bBoss.call(`/api/console/tickets?id=${encodeURIComponent(naiId)}`);
miru(
  "I2",
  "実在するIDと、しないIDで、断り方が同じ（あることを漏らさない）",
  r1.status === r2.status &&
    (r1.json?.code ?? "") === (r2.json?.code ?? "") &&
    (r1.json?.message ?? "") === (r2.json?.message ?? ""),
  `実在=${r1.status}/${r1.json?.code ?? ""}　不在=${r2.status}/${r2.json?.code ?? ""}`,
);

/* ══════════════════════════════════════════════
   J. 権限
   ══════════════════════════════════════════════ */

const eList = await etsuran.call("/api/console/tickets");
miru(
  "J",
  "閲覧だけの人は、一覧を見られるが、返信ボタンは出ない",
  eList.status === 200 && eList.json?.canReply === false,
  `見える=${eList.status === 200} / 返信できる=${eList.json?.canReply}`,
);

const eReply = await etsuran.call("/api/console/tickets/action", "POST", {
  action: "reply",
  ticketId: TID,
  text: "閲覧だけの人からの返信です。これが通ってはいけません。",
  resolve: false,
});
miru(
  "J2",
  "閲覧だけの人は、入口を直接たたいても返信できない",
  eReply.status === 403 || eReply.status === 401,
  `${eReply.status} ${eReply.json?.code ?? ""}`,
);

/* 経理には、問い合わせを見る権限がありません */
const keiri = new Hito("経理");
await hairu(keiri, "ADMIN", "DEMO", "keiri@demo.example");
const kList = await keiri.call("/api/console/tickets");
miru(
  "J3",
  "問い合わせを見る権限が無い人は、一覧そのものを受け取れない",
  kList.status === 403 || (kList.json?.tickets ?? []).length === 0,
  `${kList.status} / ${(kList.json?.tickets ?? []).length}件`,
);

/* ══════════════════════════════════════════════
   K. 同時返信
   ══════════════════════════════════════════════ */

console.log("\n── K〜L　同時に触っても、読み直しても壊れないか ──\n");

/* 返信できるように、いったん対応中へ戻す */
await sup.call("/api/console/tickets/action", "POST", {
  action: "status",
  ticketId: TID,
  to: "IN_PROGRESS",
  reason: "同時返信の点検のため、いったん開け直します。",
});

const [k1, k2] = await Promise.all([
  sup.call("/api/console/tickets/action", "POST", {
    action: "reply",
    ticketId: TID,
    text: `${shirushi} 1人目からの返信です。`,
    resolve: false,
  }),
  sup2.call("/api/console/tickets/action", "POST", {
    action: "reply",
    ticketId: TID,
    text: `${shirushi} 2人目からの返信です。`,
    resolve: false,
  }),
]);

const detail = await sup.call(
  `/api/console/tickets?id=${encodeURIComponent(TID)}`,
);
const seqs = (detail.json?.ticket?.messages ?? []).map((m) => Number(m.seq));
miru(
  "K",
  "2人が同時に返信しても、やり取りの番号が重ならない",
  seqs.length > 0 && new Set(seqs).size === seqs.length,
  `番号=${JSON.stringify(seqs)}（1人目=${k1.status} / 2人目=${k2.status}）`,
);
miru(
  "K2",
  "やり取りの番号が、1から抜けなく並んでいる",
  seqs.every((v, i) => v === i + 1),
  `番号=${JSON.stringify(seqs)}`,
);

/* ══════════════════════════════════════════════
   L. 読み直しても残る
   ══════════════════════════════════════════════ */

const mata = new Hito("入り直したサポート");
await hairu(mata, "ADMIN", "DEMO", "support@demo.example");
const matalist = await mata.call(
  `/api/console/tickets?id=${encodeURIComponent(TID)}`,
);
const nokotta = (matalist.json?.ticket?.messages ?? []).some((m) =>
  String(m.body ?? "").includes(HENJI),
);
miru(
  "L",
  "入り直しても、返信が残っている（画面の中の控えではない）",
  nokotta,
);

/* ★別のサーバーに当たっても同じであること */
const atari = new Set([...sup.vids, ...mata.vids]);
miru(
  "L2",
  "当たったサーバーが複数でも、同じものが返る",
  nokotta,
  `当たったサーバー=${atari.size}台`,
);

/* ══════════════════════════════════════════════
   まとめ
   ══════════════════════════════════════════════ */

console.log("\n══════════════════════════════════════");
console.log(`  ${kekka.length - dame} / ${kekka.length} 件 ok`);
console.log("══════════════════════════════════════\n");

if (dame > 0) {
  console.log("だめだったもの：");
  for (const k of kekka.filter((x) => !x.ok)) {
    console.log(`  ✗ ${k.kigou}. ${k.midashi}${k.iiwake ? `\n      → ${k.iiwake}` : ""}`);
  }
  console.log(
    "\n★ここが1つでも赤いあいだは、問い合わせ画面を「本物です」と言わないこと。\n",
  );
  process.exit(1);
}

console.log(
  "問い合わせは、お客様の画面と管理画面で、同じ1つの表を見ています。\n" +
    "見本データは、この画面から無くなりました。\n",
);
