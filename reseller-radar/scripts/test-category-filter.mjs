import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRestrictedFood } from "../lib/category-filter.mjs";

// ─── カテゴリーツリー由来（一次シグナル・最優先で除外） ───
test("サプリはカテゴリーツリーで除外", () => {
  const r = classifyRestrictedFood({
    title: "DHC コラーゲン 60日分",
    categoryTree: ["ドラッグストア", "栄養補助食品", "サプリメント・ビタミン", "コラーゲン"],
  });
  assert.equal(r.excluded, true);
  assert.equal(r.by, "category");
});

test("マルチビタミンはカテゴリーツリーで除外", () => {
  const r = classifyRestrictedFood({
    title: "ネイチャーメイド スーパーマルチビタミン",
    categoryTree: ["ドラッグストア", "栄養補助食品", "サプリメント・ビタミン", "マルチビタミン&ミネラル"],
  });
  assert.equal(r.excluded, true);
});

test("食品・飲料はカテゴリーツリーで除外", () => {
  assert.equal(classifyRestrictedFood({ title: "缶コーヒー", categoryTree: ["食品・飲料・お酒", "飲料", "コーヒー"] }).excluded, true);
  assert.equal(classifyRestrictedFood({ title: "味噌汁", categoryTree: ["食品・飲料・お酒", "食品", "スープ"] }).excluded, true);
});

// ─── 非食品はカテゴリーツリーで除外しない（誤除外ゼロが最重要） ───
test("歯ブラシ(ドラッグストアだが食品でない)は除外しない", () => {
  const r = classifyRestrictedFood({
    title: "デントヘルス ハブラシ ふつう",
    categoryTree: ["ドラッグストア", "オーラルケア", "歯ブラシ・アクセサリ", "大人用歯ブラシ"],
  });
  assert.equal(r.excluded, false);
});

test("化粧品(ビューティー)は除外しない", () => {
  const r = classifyRestrictedFood({
    title: "DHC 薬用リップクリーム",
    categoryTree: ["ビューティー", "スキンケア・ボディケア", "リップケア・リップクリーム"],
  });
  assert.equal(r.excluded, false);
});

test("電子機器・玩具・家電は除外しない", () => {
  assert.equal(classifyRestrictedFood({ title: "Anker モバイルバッテリー 10000mAh", categoryTree: ["家電&カメラ", "モバイルバッテリー"] }).excluded, false);
  assert.equal(classifyRestrictedFood({ title: "レゴ クラシック", categoryTree: ["おもちゃ", "ブロック"] }).excluded, false);
  assert.equal(classifyRestrictedFood({ title: "タニタ 体組成計", categoryTree: ["ホーム&キッチン", "計測器"] }).excluded, false);
  assert.equal(classifyRestrictedFood({ title: "象印 電気ケトル", categoryTree: ["ホーム&キッチン", "電気ポット・ケトル"] }).excluded, false);
  assert.equal(classifyRestrictedFood({ title: "ブラウン シェーバー", categoryTree: ["ドラッグストア", "シェービング", "電気シェーバー"] }).excluded, false);
});

// ─── 商品名フォールバック（カテゴリーが取れない照合用） ───
test("カテゴリー無しでも商品名でサプリを除外", () => {
  assert.equal(classifyRestrictedFood({ title: "ザバス ホエイプロテイン100 ココア味" }).excluded, true);
  assert.equal(classifyRestrictedFood({ title: "ディアナチュラ 葉酸 60日分" }).excluded, true);
  assert.equal(classifyRestrictedFood({ title: "国産 青汁 30包" }).excluded, true);
});

test("カテゴリー無しでもサプリ成分名でサプリを除外", () => {
  assert.equal(classifyRestrictedFood({ title: "DHC 大豆イソフラボン エクオール 20日分" }).excluded, true);
  assert.equal(classifyRestrictedFood({ title: "小林製薬 ノコギリヤシ 30日分" }).excluded, true);
  assert.equal(classifyRestrictedFood({ title: "サントリー セサミンEX オリザプラス" }).excluded, true);
  assert.equal(classifyRestrictedFood({ title: "やわた 国産 田七人参" }).excluded, true);
});

test("サプリ成分名の追加が化粧品/家電を誤除外しない", () => {
  // bare「イソフラボン」は除外語に入れていない＝化粧品(化粧水)は販売可のまま
  assert.equal(classifyRestrictedFood({ title: "イソフラボン配合 保湿化粧水 200ml", categoryTree: ["ビューティー", "スキンケア", "化粧水"] }).excluded, false);
  // 家電・ガジェットは誤除外しない
  assert.equal(classifyRestrictedFood({ title: "パナソニック 電動歯ブラシ ドルツ" }).excluded, false);
});

test("商品名フォールバックが非食品を誤除外しない", () => {
  assert.equal(classifyRestrictedFood({ title: "SanDisk microSD 128GB" }).excluded, false);
  assert.equal(classifyRestrictedFood({ title: "サーモス 水筒 500ml" }).excluded, false);
  assert.equal(classifyRestrictedFood({ title: "パナソニック エネループ 単3形 8本" }).excluded, false);
  assert.equal(classifyRestrictedFood({ title: "オムロン 体温計" }).excluded, false);
});

test("空入力は除外しない", () => {
  assert.equal(classifyRestrictedFood({}).excluded, false);
  assert.equal(classifyRestrictedFood({ title: "", categoryTree: [] }).excluded, false);
});

// ─── 酒類（要承認/原則不可） ───
test("酒類はカテゴリー/商品名で除外", () => {
  assert.equal(classifyRestrictedFood({ title: "獺祭 純米大吟醸 720ml", categoryTree: ["食品・飲料・お酒", "ビール・洋酒", "日本酒・焼酎"] }).excluded, true);
  assert.equal(classifyRestrictedFood({ title: "サントリー 山崎 ウイスキー 700ml" }).excluded, true);
});

test("ビールサーバー等の家電は酒類扱いしない", () => {
  assert.equal(classifyRestrictedFood({ title: "山善 ビールサーバー 家庭用", categoryTree: ["ホーム&キッチン", "調理家電"] }).excluded, false);
});

// ─── 医薬品（第1〜3類） ───
test("第2類医薬品は除外", () => {
  assert.equal(classifyRestrictedFood({ title: "ロキソニンS 12錠【第1類医薬品】", categoryTree: ["ドラッグストア", "医薬品", "解熱鎮痛剤"] }).excluded, true);
  assert.equal(classifyRestrictedFood({ title: "【第2類医薬品】 鼻炎薬" }).excluded, true);
});

test("医療機器(血圧計/体温計)は医薬品扱いしない＝販売可", () => {
  assert.equal(classifyRestrictedFood({ title: "オムロン 上腕式血圧計", categoryTree: ["ドラッグストア", "医療・衛生用品", "血圧計"] }).excluded, false);
  assert.equal(classifyRestrictedFood({ title: "オムロン 電子体温計 けんおんくん", categoryTree: ["家電&カメラ", "健康家電", "体温計"] }).excluded, false);
});

test("医薬部外品(薬用シャンプー等)は除外しない＝販売可", () => {
  assert.equal(classifyRestrictedFood({ title: "メリット 薬用シャンプー 詰め替え", categoryTree: ["ビューティー", "ヘアケア", "シャンプー"] }).excluded, false);
});

// ─── たばこ（出品禁止） ───
test("たばこは除外", () => {
  assert.equal(classifyRestrictedFood({ title: "加熱式たばこ 専用スティック", categoryTree: ["食品・飲料・お酒", "たばこ"] }).excluded, true);
});
