/**
 * 管理画面に「入る」ところだけを、1か所にまとめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ分けたのか
 * ═══════════════════════════════════════════════════════
 *
 *   管理画面を実際に触って確かめる道具が、いくつもあります。
 *   そのどれもが、最初に「ログインして中へ入る」を書いていました。
 *   同じ手順が、別々の場所に何度も書かれていたわけです。
 *
 *   そこへ、入り方が変わりました。
 *
 *       前：練習用の「デモ管理者としてログイン」を押すだけ
 *       今：Preview では、本番と同じログイン画面が出る
 *
 *   すると、直し忘れた道具から順に落ちます。
 *   落ちた理由も「押しても出ない」としか出ないので、
 *   受け取った人には何のことか分かりません。
 *   実際にこれで止まりました（2026-08-26）。
 *
 *   ★入り方の知識は、これ以上ばらまかないこと。
 *     入り方が変わるたびに、探して回ることになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★合言葉を、ここに書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   パスワードは環境変数から受け取ります。
 *   ここに直接書くと、そのままGitに残り、
 *   あとから消しても履歴には残り続けます。
 *
 *       UX_ADMIN_PASSWORD  … 管理者のパスワード
 *       UX_ADMIN_EMAIL     … 管理者のメールアドレス
 *       UX_TENANT_CODE     … 会社コード
 *
 *   使い捨ての会社を自分で作る道具（E2E）は、環境変数ではなく
 *   enterConsole の第3引数で、その場の合言葉を渡します。
 *   ★その場合も、合言葉を「呼ぶ側で作る」こと。
 *     ここに既定値として書くと、結局Gitに残ります。
 */

/**
 * 同じところを、出るまで何度か押す。
 *
 * ★1回で決めつけないこと。
 *   画面が組み上がる途中だと、押しても何も起きません。
 */
export async function press(page, selector, until, tries = 8) {
  for (let i = 0; i < tries; i += 1) {
    await page.locator(selector).first().click({ timeout: 5000 }).catch(() => {});
    try {
      await page.waitForSelector(until, { timeout: 2000 });
      return;
    } catch {
      /* 空振り。もう一度押す */
    }
  }
  throw new Error(`${selector} を押しても ${until} が出ない`);
}

/**
 * 画面が「本当に押せる状態」になるまで待つ。
 *
 * ═══════════════════════════════════════════════════════
 * ★これが無いと、ログインが黙って素通りします（2026-09-07）
 * ═══════════════════════════════════════════════════════
 *
 *   画面の見た目は、中身が動き出す前に先に出ます。
 *   （サーバーが作ったHTMLが先に届き、
 *     そのあとブラウザ側の仕組みが後から乗ります）
 *
 *   乗る前にログインを押すと、こうなります。
 *
 *       ・押した合図を受け取る係が、まだ居ない
 *       ・そのため、ブラウザが昔ながらのやり方で
 *         ページごと送信してしまう（/login? へ移動）
 *       ・打ち込んだ内容は消え、ログイン画面に戻る
 *       ・エラーは1つも出ない
 *
 *   実際に、これで「20秒待っても管理画面が出ない」と
 *   出続けました。通信の記録にも、画面のエラーにも、
 *   何も残らないので、原因がまったく見えません。
 *
 *   ★「待ち時間を伸ばす」で誤魔化さないこと。
 *     待っても、押し直さないかぎり永遠に入れません。
 *
 *   見分け方：ブラウザ側の仕組みが乗ると、
 *   その部品のDOMに専用の目印が付きます。それを見ます。
 */
export async function machiUgokidasu(page, selector = "form", ms = 20000) {
  await page.waitForSelector(selector, { timeout: ms });
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return Object.keys(el).some(
        (k) => k.startsWith("__react") || k.startsWith("_reactListening"),
      );
    },
    selector,
    { timeout: ms },
  );
}

/**
 * 管理画面の中まで入る。
 *
 * 入り方は2通りあります。どちらでも入れます。
 *
 *   ① 練習用の入口（DEMO_MODE=on。手元で動かすとき）
 *      「デモ管理者としてログイン」を押すだけです。
 *
 *   ② 本物のログイン（Preview など）
 *      会社コード・メールアドレス・パスワードを打ちます。
 *      本番と同じ入り方です。
 *
 * ★①だけを見る作りに戻さないこと。
 *   戻すと、本物のログインが要る場所では必ず落ち、
 *   確かめたかったことを一度も確かめられないまま終わります。
 *
 * @param creds 使い捨ての会社で作った担当者で入りたいとき用。
 *              { tenantCode, email, password } を渡します。
 *              ★渡したときは、練習用の入口を使いません。
 *                練習用で入ると「デモ会社の担当者」になり、
 *                自分で作った会社のデータが1件も見えないまま
 *                「0件でした」と report されます。
 */
export async function enterConsole(page, url, creds = null) {
  /* はじめての方への案内は、先に「見たこと」にしておく。
     案内は画面の手前に出るので、出たままだと何も押せません */
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gachaos.admin.tour.v1", "done");
    } catch {
      /* 保存が使えない環境。そのときは案内も出ません */
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);

  const demoButton = page.locator('button:has-text("デモ管理者としてログイン")');
  if (!creds && (await demoButton.count()) > 0) {
    await press(
      page,
      'button:has-text("デモ管理者としてログイン")',
      'input[placeholder="000000"]',
    );
    await page.locator('input[placeholder="000000"]').fill("204815");
    await press(
      page,
      'button:has-text("管理画面に入る")',
      'nav[aria-label="管理メニュー"]',
    );
    await page.waitForTimeout(400);
    return "demo";
  }

  /* 本物のログイン */
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  /* ★中身が動き出すまで待つこと。理由は machiUgokidasu に書いてあります */
  await machiUgokidasu(page, "form", 30000);
  await page.locator('button:has-text("運営の方")').first().click().catch(() => {});

  /* 会社コードの欄は、出ているときだけ埋める。
     1社しか入らない設定では、この欄そのものが出ません */
  /* ★見本の文字（placeholder）で欄を探さないこと。
       ここは以前「例：DEMO」でしたが、本物のお客様が
       その例をご自分のコードだと思って入れてしまうため、
       「半角英数字」に書き換えました。
       その日から、この道具は黙って会社コードを入れないまま
       ログインを押し続けていました。
       欄の役割（autocomplete）で探せば、言葉が変わっても壊れません。 */
  const tenant = page.locator('input[autocomplete="organization"]');
  if ((await tenant.count()) > 0) {
    await tenant.fill(
      creds?.tenantCode || process.env.UX_TENANT_CODE || "DEMO",
    );
  }

  await page
    .locator('input[type="email"]')
    .fill(creds?.email || process.env.UX_ADMIN_EMAIL || "boss@demo.example");
  await page
    .locator('input[type="password"]')
    .fill(creds?.password || process.env.UX_ADMIN_PASSWORD || "");

  await page.locator('button[type="submit"]').first().click();

  /* ★念のための受け皿。
       それでもページごと送信されてしまったとき（URLに ? が付いて
       ログイン画面に戻る）は、打ち直してもう一度だけ押します。
       黙って20秒待ち続けるより、原因が分かる形で残ります。 */
  try {
    await page.waitForSelector('nav[aria-label="管理メニュー"]', { timeout: 20000 });
  } catch (e) {
    if (!/\/login/.test(page.url())) throw e;
    await machiUgokidasu(page, "form", 30000);
    await page.locator('button:has-text("運営の方")').first().click().catch(() => {});
    const t2 = page.locator('input[autocomplete="organization"]');
    if ((await t2.count()) > 0) {
      await t2.fill(creds?.tenantCode || process.env.UX_TENANT_CODE || "DEMO");
    }
    await page
      .locator('input[type="email"]')
      .fill(creds?.email || process.env.UX_ADMIN_EMAIL || "boss@demo.example");
    await page
      .locator('input[type="password"]')
      .fill(creds?.password || process.env.UX_ADMIN_PASSWORD || "");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForSelector('nav[aria-label="管理メニュー"]', { timeout: 20000 });
  }
  await page.waitForTimeout(400);
  return "login";
}

/**
 * 左メニューの1項目を押す。
 *
 * ★名前を「含むかどうか」で探さないこと。
 *   説明文にも同じ言葉が入っています。「発送」で探すと
 *   「発送依頼」と「発送管理」の両方に当たります。
 *   行の1つめの札には aria-label に画面名がそのまま入っているので、
 *   そこと完全に一致するものだけを押します。
 *   （★印のボタンは「○○をよく使うに入れる」なので当たりません）
 *
 * ★a と button の両方を見ること。
 *   メニューは、途中で button から本物のリンク（a）に変わりました。
 *   別のタブで開ける・URLをコピーできるようにするためです。
 *   button だけを見ていると「見つからない」で落ちます。
 */
export async function navTo(page, label, waitMs = 350) {
  const row = page
    .locator(
      `nav[aria-label="管理メニュー"] li > a[aria-label="${label}"], ` +
        `nav[aria-label="管理メニュー"] li > button[aria-label="${label}"]`,
    )
    .first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.waitForTimeout(waitMs);
}
