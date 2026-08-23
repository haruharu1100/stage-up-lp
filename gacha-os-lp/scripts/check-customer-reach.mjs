/**
 * お客様側（スマホ）で「押せない・届かない」を機械で止める。
 *
 * ═══════════════════════════════════════════════
 * ★なぜこれが要るのか
 * ═══════════════════════════════════════════════
 *
 *   管理画面では「左メニューが画面の下にはみ出して押せない」が
 *   実際に起きました。作っている本人の大きな画面では気づけません。
 *
 *   お客様側は、それより危ないです。
 *   見る人のほぼ全員がスマホで、しかも画面の下には
 *     ・下タブ（固定）
 *     ・DAY IN THE LIFE の案内パネル（固定）
 *     ・iPhone のホームバー（safe-area）
 *   の3つが重なります。
 *   1つでも計算を間違えると、いちばん大事なボタンが
 *   その裏に入って、押しても反応しないように見えます。
 *
 *   ★だから、目で見て確かめるのをやめます。
 *     ここでやるのは、実際の幅で
 *
 *         スクロールする → 実際にクリックする → 次の画面が出たか
 *
 *     を、ひと通りの流れについて機械に繰り返させることです。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *     node scripts/check-customer-reach.mjs http://localhost:3210
 *
 *   1つでも届かないものがあれば、終了コード 1 で落ちます。
 *
 * ═══════════════════════════════════════════════
 * ★直すときの注意
 * ═══════════════════════════════════════════════
 *
 *   ・「見えているか」で判定しないこと。
 *     半分だけ見えている状態でも見えていることになります。
 *
 *   ・画面の幅を広げて通そうとしないこと。
 *     狭い画面で押せないことが問題なので、
 *     狭い画面を外したら、確かめる意味がなくなります。
 *
 *   ・44px の下限を下げないこと。
 *     指で押すものの大きさです。詰めると、隣を押します。
 *     お金が動く画面での押し間違いは、そのまま事故になります。
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PW_DIR =
  process.env.PLAYWRIGHT_DIR ||
  join(ROOT, "..", "blog-to-social", "node_modules", "playwright");

if (!existsSync(PW_DIR)) {
  console.error(
    `playwright が見つかりません: ${PW_DIR}\n` +
      "PLAYWRIGHT_DIR に playwright のフォルダを指定してください。",
  );
  process.exit(1);
}

const require_ = createRequire(import.meta.url);
const pwMod = await import(
  pathToFileURL(require_.resolve(join(PW_DIR, "index.js"))).href
);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
if (!chromium) {
  console.error("playwright から chromium を取り出せませんでした。");
  process.exit(1);
}

const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");
const URL = `${BASE}/client-demo`;
const SHOT_DIR = join(ROOT, "public", "shots", "customer");
mkdirSync(SHOT_DIR, { recursive: true });

/**
 * 確かめる画面の幅。
 *
 * ★390 だけで通しても意味がありません。
 *   375 は、いまも現役の小さい iPhone です。
 *   360 は、Android でいちばん多い幅です。
 *   ここが通らないと、Android の相当数が押せません。
 */
const SIZES = [
  { w: 390, h: 844, name: "iPhone 390×844" },
  { w: 375, h: 667, name: "iPhone SE 375×667" },
  { w: 360, h: 800, name: "Android 360×800" },
  { w: 412, h: 915, name: "Android 412×915" },
  { w: 430, h: 932, name: "iPhone Max 430×932" },
];

const bad = [];
let checked = 0;

/**
 * 押したのに反応しない、を織り込む。
 *
 * ★絵が出るのと、押せるようになるのは別の瞬間です。
 *   人は反応が無ければもう一度押すので、機械にも同じことをさせます。
 */
async function press(page, locator, until, what) {
  for (let i = 0; i < 8; i += 1) {
    await locator.first().click({ timeout: 5000 }).catch(() => {});
    try {
      await page.waitForSelector(until, { timeout: 2000 });
      return true;
    } catch {
      /* 空振り。もう一度押す */
    }
  }
  bad.push(`${what}：押しても「${until}」が出ない`);
  return false;
}

/**
 * その要素に、指がちゃんと届くか。
 *
 * ★真ん中の1点が、上の帯や下タブに隠れていないかを見ます。
 *   クリックできるかどうかは、実際にその点に何があるかで決まります。
 *   「画面の中にある」だけでは、裏に回り込んでいても通ってしまいます。
 */
async function reachable(page, locator, what, min = 44) {
  try {
    await locator.first().scrollIntoViewIfNeeded({ timeout: 3000 });
  } catch {
    bad.push(`${what}：画面に出てこない`);
    return;
  }

  /**
   * ★下タブの裏に入ったら、その分だけ送ってやり直すこと。
   *
   *   ブラウザの「見える位置まで送る」は、下に貼り付いている帯を
   *   知りません。ぎりぎり画面に入った＝下タブの裏、になります。
   *   人は、そこで指をもう少し動かします。同じことをさせます。
   *
   *   それでも抜けられないなら、そのときは本当に押せません。
   *   ページの下の余白が、下タブの高さより短いということです。
   */
  for (let i = 0; i < 3; i += 1) {
    const gap = await locator.first().evaluate((el) => {
      const b = el.getBoundingClientRect();
      const n = document.querySelector('nav[aria-label="メニュー"]');
      if (!n) return 0;
      const nb = n.getBoundingClientRect();
      return Math.max(0, Math.ceil(b.bottom + 8 - nb.top));
    });
    if (gap === 0) break;
    await page.evaluate((d) => window.scrollBy(0, d), gap);
    await page.waitForTimeout(60);
  }

  const r = await locator.first().evaluate(
    (el, minH) => {
      const b = el.getBoundingClientRect();
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        h: Math.round(b.height),
        w: Math.round(b.width),
        vh: window.innerHeight,
        vw: window.innerWidth,
        covered: !(hit && (el === hit || el.contains(hit) || hit.contains(el))),
        /* ★何に隠れたのかを、たどれる形で書き出すこと。
             「svg に隠れた」だけでは、どの svg か分からず直せません */
        coveredBy: (() => {
          if (!hit) return "なし";
          const path = [];
          for (let n = hit; n && path.length < 5; n = n.parentElement) {
            path.push(
              n.tagName.toLowerCase() +
                (n.getAttribute("aria-label") ? `[${n.getAttribute("aria-label")}]` : "") +
                (n.className && typeof n.className === "string"
                  ? `.${n.className.split(/\s+/).slice(0, 2).join(".")}`
                  : ""),
            );
          }
          return path.join(" ← ");
        })(),
        minH,
      };
    },
    min,
  );
  checked += 1;
  if (r.top < 0 || r.bottom > r.vh + 1) {
    bad.push(`${what}：画面の外（上 ${r.top} / 下 ${r.bottom} / 画面 ${r.vh}）`);
  }
  if (r.covered) {
    bad.push(`${what}：何かの裏に入っていて押せない（上にあるのは ${r.coveredBy}）`);
  }
  if (r.h < min) {
    bad.push(`${what}：指で押すには小さい（高さ ${r.h}px ＜ ${min}px）`);
  }
  if (r.w > r.vw + 1) {
    bad.push(`${what}：横にはみ出している（幅 ${r.w}px ＞ 画面 ${r.vw}px）`);
  }
}

/**
 * 画面を移ったら、いちばん上から始まっているか。
 *
 * ★前の画面で下まで送っていた位置が残ると、
 *   次の画面の途中から始まります。見出しが見えないので、
 *   どこへ来たのか分かりません。
 *   「押したのに何も変わらなかった」と受け取られます。
 */
async function atTop(page, what) {
  const y = await page.evaluate(() => Math.round(window.scrollY));
  checked += 1;
  if (y > 2) bad.push(`${what}：移った先が途中から始まる（${y}px 下がったまま）`);
}

/** 横スクロールが出ていないか。★スマホで横に動く画面は、壊れて見えます */
async function noSideways(page, what) {
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return { scroll: d.scrollWidth, client: d.clientWidth };
  });
  /* 棚の「横に流す」部分は例外。ページ全体が動いていないかを見ます */
  if (over.scroll > over.client + 2) {
    bad.push(`${what}：ページ全体が横に動く（${over.scroll}px ＞ ${over.client}px）`);
  }
}

const browser = await chromium.launch();

for (const size of SIZES) {
  const tag = `${size.w}x${size.h}`;
  const page = await browser.newPage({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const at = (s) => `${size.name}／${s}`;

  await page.goto(URL, { waitUntil: "domcontentloaded" });

  /* ── ① お客様側へ切り替える ── */
  const ok = await press(
    page,
    page.getByRole("button", { name: /ユーザー側/ }),
    'nav[aria-label="メニュー"]',
    at("お客様側へ切り替え"),
  );
  if (!ok) {
    await page.close();
    continue;
  }

  /* ── ② 下タブ：5つ全部に手が届くか ── */
  const nav = page.locator('nav[aria-label="メニュー"]').first();
  for (const label of ["ガチャ", "獲得商品", "お知らせ", "発送", "マイページ"]) {
    await reachable(page, nav.getByRole("button", { name: label }), at(`下タブ「${label}」`), 56);
  }
  await noSideways(page, at("売り場"));
  await page.screenshot({ path: join(SHOT_DIR, `${tag}-01-shop-logout.png`), fullPage: false });

  /* ── ③ ログインしていない状態で、ガチャの中身が見られるか ── */
  const firstCard = page.locator("main button").filter({ hasText: /pt/ }).first();
  await press(page, firstCard, 'button:has-text("ガチャ一覧へ")', at("ガチャを開く（未ログイン）"));
  await noSideways(page, at("ガチャ詳細（未ログイン）"));
  await page.screenshot({ path: join(SHOT_DIR, `${tag}-02-gacha-logout.png`) });

  /* ── ④ ログイン ── */
  await press(
    page,
    page.getByRole("button", { name: /ログイン/ }).first(),
    'button:has-text("デモユーザーとして開始する"), :text("デモユーザーとして開始する")',
    at("ログイン画面を開く"),
  );
  await press(
    page,
    page.locator("button").filter({ hasText: /保有 .*pt ／ 獲得商品/ }).first(),
    'nav[aria-label="メニュー"]',
    at("デモユーザーでログイン"),
  );
  await noSideways(page, at("ログイン直後"));

  /* ── ⑤ ガチャ詳細 → 引く ──
     ★「引く」が下タブの裏に入っていないかを、ここで必ず見ること */
  await press(
    page,
    nav.getByRole("button", { name: "ガチャ" }),
    "main",
    at("下タブからガチャ一覧へ"),
  );
  await press(
    page,
    page.locator("main button").filter({ hasText: /pt/ }).first(),
    'button:has-text("ガチャ一覧へ")',
    at("ガチャを開く（ログイン後）"),
  );
  await page.screenshot({ path: join(SHOT_DIR, `${tag}-03-gacha-login.png`) });

  /* ★1回・10連・100連の3つが、指で押せる大きさで並んでいること */
  for (const label of ["1回", "10連", "100連"]) {
    const b = page.locator("main button").filter({ hasText: new RegExp(`^${label}`) }).first();
    if (await b.count()) await reachable(page, b, at(`「${label}」ボタン`));
    else bad.push(at(`「${label}」ボタンが無い`));
  }

  /* ── ⑥ 引く前の確認 → 演出 → 閉じる ──
     ★お金が動く操作を、1タップで確定させていないこと。
       確認が出ずにいきなり演出へ飛ぶなら、それは作り間違いです */
  const THEATER = '[role="dialog"][aria-label="ガチャの結果"]';
  const draw10 = page.locator("main button").filter({ hasText: /^10連/ }).first();
  if (await draw10.count()) {
    const disabled = await draw10.isDisabled();
    if (disabled) {
      bad.push(at("残高があるのに「10連」が押せない"));
    } else {
      await press(page, draw10, ':text("引く前の確認")', at("10連を押す"));
      await page.screenshot({ path: join(SHOT_DIR, `${tag}-04-buysheet.png`) });
      const sheet = page.locator('[role="dialog"]').first();
      await reachable(page, sheet.locator("button").filter({ hasText: /連を引く$/ }).first(), at("確認の「10連を引く」"));

      await press(
        page,
        sheet.locator("button").filter({ hasText: /連を引く$/ }).first(),
        THEATER,
        at("10連を確定"),
      );
      await page.waitForTimeout(2400);
      await page.screenshot({ path: join(SHOT_DIR, `${tag}-05-theater.png`) });

      for (const label of ["獲得商品を見る", "もう一度引く", "閉じる"]) {
        const b = page.locator(`${THEATER} button`).filter({ hasText: label }).first();
        if (await b.count()) await reachable(page, b, at(`演出の「${label}」`), 40);
        else bad.push(at(`演出に「${label}」が無い`));
      }
      await press(
        page,
        page.locator(`${THEATER} button`).filter({ hasText: "閉じる" }).first(),
        'nav[aria-label="メニュー"]',
        at("演出を閉じる"),
      );
      if (await page.locator(THEATER).count()) {
        bad.push(at("「閉じる」を押しても演出が消えない"));
      }
    }
  } else {
    bad.push(at("ガチャ詳細に「10連」が無い"));
  }

  /* ── ⑦ 獲得商品 → 受け取り方法 → 発送 ──
     ★下まで送った状態からタブを押すこと。
       上に居るときだけ試しても、位置が残る不具合は出てきません */
  await page.evaluate(() => window.scrollTo(0, 600));
  await press(page, nav.getByRole("button", { name: "獲得商品" }), "main", at("下タブから獲得商品へ"));
  await atTop(page, at("獲得商品"));
  await noSideways(page, at("獲得商品"));
  await page.screenshot({ path: join(SHOT_DIR, `${tag}-06-prizes.png`) });

  /* ★ここも「未選択」で絞ること。理由は下の交換のところと同じです */
  const f0 = page.locator("main button").filter({ hasText: /^未選択/ }).first();
  if (await f0.count()) {
    await f0.click();
    await page.waitForTimeout(200);
  }

  const prize = page.locator("main button").filter({ hasText: /賞 相当/ }).first();
  if (!(await prize.count())) {
    bad.push(at("未選択の獲得商品が1点も無い（発送）"));
  } else {
    await press(page, prize, 'button:has-text("獲得商品")', at("商品の詳細を開く"));
    const ship = page.locator("main button").filter({ hasText: /^発送する/ }).first();
    if (!(await ship.count())) {
      bad.push(at("未選択の商品に「発送する」が無い"));
    } else {
      await reachable(page, ship, at("「発送する」"));
      await press(page, ship, ':text("お届け先の確認")', at("発送するを押す"));
      await noSideways(page, at("お届け先の確認"));
      await page.screenshot({ path: join(SHOT_DIR, `${tag}-07-ship.png`) });
      const next = page.locator("main button").filter({ hasText: /この住所で確認へすすむ/ }).first();
      if (await next.count()) {
        await reachable(page, next, at("「この住所で確認へすすむ」"));

        /* ★お金と現物が動く最後の一押しまで、必ず通すこと。
             ここまで確かめないと「押せるが確定できない」を見逃します */
        await press(page, next, ':text("ご依頼内容の確認")', at("発送の最終確認へ"));
        await noSideways(page, at("発送の最終確認"));
        const fix = page
          .locator("main button")
          .filter({ hasText: /この内容で発送を依頼する/ })
          .first();
        if (await fix.count()) {
          await reachable(page, fix, at("「この内容で発送を依頼する」"));
          await press(page, fix, ':text("発送状況")', at("発送を確定する"));
          await page.screenshot({ path: join(SHOT_DIR, `${tag}-11-ship-done.png`) });
        } else {
          bad.push(at("発送の最終確認に確定ボタンが無い"));
        }
      } else {
        bad.push(at("お届け先の確認に「この住所で確認へすすむ」が無い"));
      }
    }
  }

  /* ── ⑦b ポイント交換 ──
     ★「もう発送できなくなる」と書いた画面を必ず挟むこと */
  await page.evaluate(() => window.scrollTo(0, 600));
  await press(page, nav.getByRole("button", { name: "獲得商品" }), "main", at("獲得商品へ戻る"));

  /* ★「未選択」で絞ってから開くこと。
       絞らずに先頭を開くと、すでに発送を選んだ商品に当たり、
       交換の道が黙って素通りされます（通ったように見えて何も見ていない） */
  const filterUnchosen = page.locator("main button").filter({ hasText: /^未選択/ }).first();
  if (await filterUnchosen.count()) {
    await reachable(page, filterUnchosen, at("絞り込み「未選択」"), 40);
    await filterUnchosen.click();
    await page.waitForTimeout(200);
  } else {
    bad.push(at("獲得商品に「未選択」の絞り込みが無い"));
  }

  const prize2 = page.locator("main button").filter({ hasText: /賞 相当/ }).first();
  if (!(await prize2.count())) {
    bad.push(at("未選択の獲得商品が1点も無い"));
  } else {
    await press(page, prize2, 'button:has-text("獲得商品")', at("交換する商品を開く"));
    const ex = page.locator("main button").filter({ hasText: /^ポイントに交換する/ }).first();
    if (!(await ex.count())) {
      bad.push(at("未選択の商品に「ポイントに交換する」が無い"));
    } else {
      await reachable(page, ex, at("「ポイントに交換する」"));
      await press(page, ex, ':text("ポイント交換の確認")', at("交換の確認へ"));
      await noSideways(page, at("交換の確認"));
      await page.screenshot({ path: join(SHOT_DIR, `${tag}-12-exchange.png`) });
      const exFix = page.locator("main button").filter({ hasText: /pt へ交換する/ }).first();
      if (await exFix.count()) {
        await reachable(page, exFix, at("「ptへ交換する」"));
        await press(page, exFix, ':text("獲得商品")', at("交換を確定する"));
      } else {
        bad.push(at("交換の確認に確定ボタンが無い"));
      }
    }
  }

  /* ── ⑧ お知らせ ── */
  await page.evaluate(() => window.scrollTo(0, 600));
  await press(page, nav.getByRole("button", { name: "お知らせ" }), ':text("お知らせ")', at("下タブからお知らせへ"));
  await atTop(page, at("お知らせ"));
  await noSideways(page, at("お知らせ"));
  await page.screenshot({ path: join(SHOT_DIR, `${tag}-08-notices.png`) });

  /* ── ⑨ 発送状況 ── */
  await page.evaluate(() => window.scrollTo(0, 600));
  await press(page, nav.getByRole("button", { name: "発送" }), ':text("発送状況")', at("下タブから発送状況へ"));
  await atTop(page, at("発送状況"));
  await noSideways(page, at("発送状況"));

  /* ── ⑩ マイページ → ポイント履歴 ── */
  await page.evaluate(() => window.scrollTo(0, 600));
  await press(page, nav.getByRole("button", { name: "マイページ" }), ':text("マイページ")', at("下タブからマイページへ"));
  await atTop(page, at("マイページ"));
  await noSideways(page, at("マイページ"));
  await page.screenshot({ path: join(SHOT_DIR, `${tag}-09-mypage.png`) });

  const pt = page.locator("main button").filter({ hasText: /保有ポイント/ }).first();
  if (await pt.count()) {
    await press(page, pt, ':text("ポイント履歴")', at("ポイント履歴を開く"));
    await noSideways(page, at("ポイント履歴"));
    await page.screenshot({ path: join(SHOT_DIR, `${tag}-10-points.png`) });
  }

  /* ── ⑩b お問い合わせ ──
     ★0件でも入口が押せること。
       「問い合わせがある人だけ押せる」作りにすると、
       いちばん困っている方の行き先が消えます */
  await press(page, nav.getByRole("button", { name: "マイページ" }), ':text("マイページ")', at("マイページへ"));
  const sup = page.locator("main button").filter({ hasText: /お問い合わせ/ }).first();
  if (await sup.count()) {
    await reachable(page, sup, at("「お問い合わせ」の入口"));
    await press(page, sup, "main textarea", at("お問い合わせを開く"));
    await noSideways(page, at("お問い合わせ"));
    const ta = page.locator("main textarea").first();
    await ta.fill("デモの確認です。届いた商品の交換について教えてください。");
    const send = page.locator("main button").filter({ hasText: /^送信する/ }).first();
    if (await send.count()) {
      await reachable(page, send, at("「送信する」"));
      await press(page, send, ':text("これまでのお問い合わせ")', at("問い合わせを送る"));
      await page.screenshot({ path: join(SHOT_DIR, `${tag}-13-support.png`) });
    } else {
      bad.push(at("お問い合わせに「送信する」が無い"));
    }
  } else {
    bad.push(at("マイページに「お問い合わせ」の入口が無い"));
  }

  /* ── ⑩c お届け先の変更 ── */
  await press(page, nav.getByRole("button", { name: "マイページ" }), ':text("マイページ")', at("マイページへ戻る（住所）"));
  const addr = page.locator("main button").filter({ hasText: /^お届け先/ }).first();
  if (await addr.count()) {
    await reachable(page, addr, at("「お届け先」の入口"));
    await press(page, addr, ':text("お届け先の変更")', at("お届け先を開く"));
    await noSideways(page, at("お届け先の変更"));
    for (const label of ["お名前", "郵便番号", "ご住所", "お電話番号"]) {
      const f = page.locator("main label").filter({ hasText: label }).first();
      if (await f.count()) await reachable(page, f.locator("input").first(), at(`入力欄「${label}」`), 40);
      else bad.push(at(`お届け先に「${label}」が無い`));
    }
    await page.screenshot({ path: join(SHOT_DIR, `${tag}-14-address.png`) });
  } else {
    bad.push(at("マイページに「お届け先」の入口が無い"));
  }

  /* ── ⑪ いちばん下まで送っても、最後の要素が下タブの裏に入らないか ── */
  await press(page, nav.getByRole("button", { name: "マイページ" }), ':text("マイページ")', at("マイページへ戻る"));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const tail = await page.evaluate(() => {
    const n = document.querySelector('nav[aria-label="メニュー"]');
    const ps = [...document.querySelectorAll("main *")];
    const last = ps[ps.length - 1];
    if (!n || !last) return null;
    return {
      navTop: Math.round(n.getBoundingClientRect().top),
      lastBottom: Math.round(last.getBoundingClientRect().bottom),
    };
  });
  if (tail && tail.lastBottom > tail.navTop + 1) {
    bad.push(
      at(`いちばん下の中身が下タブの裏（中身 ${tail.lastBottom}px ＞ タブ ${tail.navTop}px）`),
    );
  }

  await page.close();
}

await browser.close();

console.log(`\n確かめた押しどころ：${checked} 個 ／ 幅 ${SIZES.length} 種`);
if (bad.length) {
  console.error(`\n■ 届かない・押せない：${bad.length} 件\n`);
  for (const b of bad) console.error(`  ・${b}`);
  console.error(`\nスクリーンショット：${SHOT_DIR}`);
  process.exit(1);
}
console.log(`すべて押せました。スクリーンショット：${SHOT_DIR}`);
