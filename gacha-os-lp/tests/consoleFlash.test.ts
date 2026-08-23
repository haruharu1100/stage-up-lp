/**
 * 画面上部の「お知らせ帯」が、次の画面まで居座らないこと。
 *
 * ═══════════════════════════════════════════════
 * ★何が起きていたのか
 * ═══════════════════════════════════════════════
 *
 *   知らせは「閉じる」を押すまで消えませんでした。結果、こうなります。
 *
 *       ガチャをまわす   → 「C賞でした」
 *       受取の画面へ移動 → 「C賞でした」がまだ上に出ている
 *       交換の画面へ移動 → まだ出ている
 *
 *   画面の上に出ている文は、いま見ている画面の話だと読まれます。
 *   ガチャの結果が受取の画面の上に出ていれば、
 *   受取の手続きが終わったのだと読み違えます。
 *
 * ═══════════════════════════════════════════════
 * ★ここで確かめること
 * ═══════════════════════════════════════════════
 *
 *   ① 知らせ1つずつに、通し番号が付いていること
 *   ② 同じ文の知らせでも、番号は別になること
 *   ③ 消す仕組みが、管理画面とお客様画面の両方に付いていること
 *   ④ 消えるまでの時間が、読み終えられる長さであること
 *
 * ★①②が要る理由。
 *   消す係は「知らせが変わったら数え直す」で動きます。
 *   文だけで見ていると、同じ文の2回目は「変わっていない」ことになり、
 *   1回目の数え直しがそのまま進んで、2回目が出た直後に消えます。
 *   引いた結果が一瞬で消える、が起きます。
 *
 * ★③を「片方だけ」で済ませないこと。
 *   お客様側だけ直しても、運営の方は毎日同じ帯を見続けます。
 *   逆も同じです。両方に付いて、はじめて直ったことになります。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEMO_ADMINS,
  FLASH_MS,
  initialState,
  reducer,
  type ConsoleState,
} from "../lib/console/state";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** 管理者としてログインし、2段階認証まで通した状態を作る */
function loggedIn(): ConsoleState {
  let s = initialState();
  s = reducer(s, { type: "LOGIN", adminId: DEMO_ADMINS[0].id });
  s = reducer(s, { type: "MFA_OK" });
  return s;
}

test("知らせには、必ず通し番号が付く", () => {
  const s = loggedIn();
  assert.ok(s.flash, "ログインしたのに、知らせが出ていません。");
  assert.equal(
    typeof s.flash.at,
    "number",
    "知らせに通し番号がありません。消す係が、新しい知らせだと気づけません。",
  );
  assert.ok(s.flash.at > 0, "通し番号が 0 から始まっています。");
});

test("同じ文の知らせでも、通し番号は別になる", () => {
  /* ★ここが本丸です。
       「C賞でした」を2回続けて出したとき、
       2回目が「変わっていない」と見なされると、
       1回目の数え直しがそのまま進んで、2回目は出た直後に消えます。 */
  /* 担当者の切り替えで、まったく同じ文をもう一度出させます。
       A →（B に切り替えました）→ A →（B に切り替えました）
     2回目と4回目は、1文字も違いません。 */
  const a = DEMO_ADMINS[0].id;
  const b = DEMO_ADMINS[1].id;

  let s = loggedIn();
  s = reducer(s, { type: "SWITCH_ADMIN", adminId: b });
  const one = s.flash!;

  s = reducer(s, { type: "SWITCH_ADMIN", adminId: a });
  s = reducer(s, { type: "SWITCH_ADMIN", adminId: b });
  const two = s.flash!;

  assert.equal(
    one.text,
    two.text,
    "前提が崩れています。同じ文の知らせを2回出せていません。",
  );
  assert.ok(
    two.at > one.at,
    `文が同じなのに通し番号も同じです（${one.at} → ${two.at}）。` +
      "2つ目の知らせが、出た直後に消えます。",
  );
});

test("知らせを消したあとに出した知らせにも、番号が付く", () => {
  /* 消えたあとは、番号が振り出しに戻ります。
     それでも「知らせが無い状態」を必ず1度はさむので、
     消す係は、次のものを新しい知らせだと見分けられます。 */
  let s = loggedIn();

  s = reducer(s, { type: "CLEAR_FLASH" });
  assert.equal(s.flash, null, "消えていません。");

  s = reducer(s, { type: "SWITCH_ADMIN", adminId: DEMO_ADMINS[1].id });
  assert.ok(s.flash, "次の知らせが出ていません。");
  assert.ok(s.flash.at > 0, "消えたあとの知らせに、番号が付いていません。");
});

test("知らせを消したら、何も残らない", () => {
  let s = loggedIn();
  assert.ok(s.flash, "前提が崩れています。");
  s = reducer(s, { type: "CLEAR_FLASH" });
  assert.equal(s.flash, null, "消したはずの知らせが残っています。");
});

test("消えるまでの時間が、読み終えられる長さである", () => {
  /* ★短くしすぎないこと。
       日本語で40字ほどの文を読み終えるには数秒かかります。
       2秒で消える知らせは、出していないのと同じです。
     ★長くしすぎないこと。
       20秒も残るなら、次の画面まで付いてくるのと変わりません。 */
  assert.ok(
    FLASH_MS >= 4000,
    `${FLASH_MS}ミリ秒では、読み終える前に消えます。`,
  );
  assert.ok(
    FLASH_MS <= 10000,
    `${FLASH_MS}ミリ秒は長すぎます。次の画面まで付いてきます。`,
  );
});

test("消す仕組みが、運営側とお客様側の両方に付いている", () => {
  const both = [
    ["components/console/Shell.tsx", "運営の管理画面"],
    ["components/console/customer/MyPage.tsx", "お客様の画面"],
  ] as const;

  for (const [file, who] of both) {
    assert.ok(
      /useFlash\(/.test(read(file)),
      `${who}（${file}）で、知らせを消す仕組みを使っていません。` +
        "片方だけ直しても、もう片方の人は毎日同じ帯を見続けます。",
    );
  }
});

test("実物で見るための目印が、両方の帯に付いている", () => {
  /* ★scripts/check-flash.mjs は、この目印で帯を探します。
       目印を消すと、実物での確認ができなくなります。
       見た目には何も影響しない属性なので、消さないでください。 */
  const both = [
    ["components/console/Shell.tsx", "運営の管理画面"],
    ["components/console/customer/MyPage.tsx", "お客様の画面"],
  ] as const;

  for (const [file, who] of both) {
    assert.ok(
      /data-flash="1"/.test(read(file)),
      `${who}（${file}）の帯に、目印 data-flash="1" がありません。` +
        "実物の画面で「消えたかどうか」を確かめられなくなります。",
    );
  }
});

test("消え方が、時間と画面移動の両方そろっている", () => {
  const hook = read("components/console/useFlash.ts");
  assert.ok(
    /setTimeout/.test(hook) && /FLASH_MS/.test(hook),
    "時間でも消える仕組みがありません。同じ画面に居る限り、永久に残ります。",
  );
  assert.ok(
    /clearTimeout/.test(hook),
    "数え直しの片付けをしていません。前の数え直しが、次の知らせを消しにきます。",
  );
  assert.ok(
    /flash\?\.at/.test(hook),
    "文ではなく通し番号で見張っていません。同じ文の2回目が一瞬で消えます。",
  );
});
