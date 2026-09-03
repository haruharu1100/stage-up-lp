/**
 * 広告の計測が「つながっているか」の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここが切れると、どうなるか
 * ═══════════════════════════════════════════════════════
 *
 *   広告費だけが出ていき、何が効いたのか最後まで分かりません。
 *   しかも、切れていることは画面を見ても分かりません。
 *   サイトはいつもどおり動きます。相談も普通に届きます。
 *   広告側の管理画面に「成果 0件」と出るだけです。
 *
 *   その「0件」を見た人は、たいてい
 *   「この広告は効かない」と判断して止めます。
 *   ★実際には効いていたのに止める、がいちばん高くつく間違いです。
 *
 * ═══════════════════════════════════════════════════════
 * ★とくに大事な1本：イベント名がずれていないこと
 * ═══════════════════════════════════════════════════════
 *
 *   成果として返すイベント名は、2か所に書いてあります。
 *
 *     lib/track.ts  の EV        … 実際に送る名前
 *     config/ads.ts の対応表     … 成果として返す名前
 *
 *   ここは文字列で突き合わせています。片方の名前を変えた日に、
 *   もう片方が古いままだと、静かに切れます。
 *   その日を見つけられるのは、この試験だけです。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EV } from "../lib/track";
import { AD_CONVERSION_BY_EVENT, ads, adsEnabled } from "../config/ads";

/** 実際に送っているイベント名の一覧 */
const SENT_NAMES = new Set<string>(Object.values(EV));

test("成果として返す名前は、実際に送っている名前と一致している", () => {
  for (const name of Object.keys(AD_CONVERSION_BY_EVENT)) {
    assert.ok(
      SENT_NAMES.has(name),
      `"${name}" は、どこからも送られていません。` +
        " config/ads.ts の対応表か lib/track.ts の EV のどちらかが古くなっています。",
    );
  }
});

test("いちばん見たい成果（相談が入った）が、対応表に必ず入っている", () => {
  assert.equal(
    AD_CONVERSION_BY_EVENT[EV.contactSubmit],
    "contact",
    "相談の完了を広告へ返していません。これでは広告の良し悪しが判定できません。",
  );
});

test("学習用の成果（デモを触った）も、対応表に入っている", () => {
  /* ★理由は config/ads.ts に書いてあります。
       相談は月に数件しか起きないので、それだけでは
       広告の自動調整が学習できません。 */
  assert.equal(AD_CONVERSION_BY_EVENT[EV.demoStart], "demo");
});

test("成果は2種類だけ（増やすときは、なぜ見込みが高いのかを書くこと）", () => {
  const kinds = Array.from(new Set(Object.values(AD_CONVERSION_BY_EVENT)));
  assert.deepEqual(kinds.sort(), ["contact", "demo"]);
});

test("読んだだけ・スクロールしただけを、成果にしていない", () => {
  /* ★これを成果にすると、広告は「よく読む人」を集めます。
       読む人は、買う人ではありません。 */
  for (const name of [EV.pricingView, EV.backtestView, EV.ctaClick]) {
    assert.equal(
      AD_CONVERSION_BY_EVENT[name],
      undefined,
      `"${name}" を成果にしています。買う人ではなく、読む人が集まります。`,
    );
  }
});

test("何も設定していなければ、広告タグは1つも出さない", () => {
  /* ★出稿していないのに空のタグを置くと、
       読み込みが遅くなるだけで、何も測れません。 */
  if (!ads.google.id && !ads.meta.id && !ads.x.id) {
    assert.equal(adsEnabled(), false);
  } else {
    assert.equal(adsEnabled(), true);
  }
});

test("Google広告は、IDとラベルが両方そろって初めて成果を返せる", () => {
  /* ★IDだけ入れて満足してしまう事故が多い場所です。
       Google広告の成果は「ID／ラベル」の組で送ります。
       ラベルが空だと、送り先が "AW-123/" になり、静かに捨てられます。 */
  const readyContact = Boolean(ads.google.id && ads.google.labelContact);
  const readyDemo = Boolean(ads.google.id && ads.google.labelDemo);

  if (ads.google.id) {
    assert.ok(
      readyContact,
      "NEXT_PUBLIC_GOOGLE_ADS_LABEL_CONTACT が空です。相談の成果が届きません。",
    );
    assert.ok(
      readyDemo,
      "NEXT_PUBLIC_GOOGLE_ADS_LABEL_DEMO が空です。広告が学習できません。",
    );
  } else {
    assert.equal(readyContact, false);
    assert.equal(readyDemo, false);
  }
});
