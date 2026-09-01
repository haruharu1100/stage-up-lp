/**
 * 問い合わせの受け口（Google Apps Script のウェブアプリ）
 *
 * ═══════════════════════════════════════════════════════
 * これは何か
 * ═══════════════════════════════════════════════════════
 *
 * LP の問い合わせフォームは、送信された内容を
 * CONTACT_WEBHOOK_URL という1つのURLへ投げるだけの作りになっています。
 * その投げ先が無いと、本番では「ただいま受付ができません」と返して、
 * 届いていないのに「送信できました」とは言わない仕様です
 * （app/api/contact/route.ts の 306〜320行）。
 *
 * このファイルは、その投げ先です。やることは3つだけ。
 *
 *   1) 送られてきた内容をスプレッドシートに1行追加する（消えない記録）
 *   2) info@morika.work へメールで知らせる（気づける状態にする）
 *   3) 合言葉が合わないリクエストは、何もせず捨てる
 *
 * ═══════════════════════════════════════════════════════
 * なぜメールだけにしないのか
 * ═══════════════════════════════════════════════════════
 *
 * メールは消えます。迷惑メールにも入ります。
 * 問い合わせは、こちらが取りこぼした時点で売上がゼロになるので、
 * 「気づく手段（メール）」と「消えない記録（シート）」を必ず分けます。
 * どちらか片方が壊れても、もう片方が残ります。
 *
 * ═══════════════════════════════════════════════════════
 * 設置のしかた（ブラウザだけで終わります）
 * ═══════════════════════════════════════════════════════
 *
 *  1. Googleドライブで新しいスプレッドシートを作る（名前は「ガチャOS 問い合わせ」など）
 *  2. そのシートの [拡張機能] → [Apps Script] を開く
 *  3. 出てきたエディタの中身を全部消して、このファイルの中身を貼り付ける
 *  4. 左の歯車（プロジェクトの設定）→ [スクリプト プロパティ] で2つ登録する
 *       TOKEN       … 合言葉。英数字20文字程度を自分で決める（他人に教えない）
 *       NOTIFY_TO   … info@morika.work
 *  5. 右上 [デプロイ] → [新しいデプロイ] → 種類は「ウェブアプリ」
 *       次のユーザーとして実行 … 自分
 *       アクセスできるユーザー … 全員
 *  6. 表示された「ウェブアプリのURL」をコピーする
 *  7. そのURLの末尾に ?token=（4で決めた合言葉）を付けたものが、
 *     LP に設定する CONTACT_WEBHOOK_URL です
 *
 * ★合言葉（TOKEN）は、コードにも、Gitにも、メモにも書かないでください。
 *   スクリプトプロパティと、Vercel の環境変数の2か所だけに置きます。
 *
 * ═══════════════════════════════════════════════════════
 */

/** 受け取ったときに動く入口 */
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty('TOKEN');
    var notifyTo = props.getProperty('NOTIFY_TO');

    // 合言葉が未設定なら、開けっ放しにせず閉じる
    if (!expected) return json_({ ok: false, reason: 'not_configured' });

    var given = e && e.parameter ? e.parameter.token : '';
    if (given !== expected) return json_({ ok: false, reason: 'forbidden' });

    var p = JSON.parse(e.postData.contents);

    // ── 1) 消えない記録 ────────────────────────────
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        '受信日時', '会社名', 'お名前', 'メール', '電話',
        '興味', 'プラン', '本文', '流入元', 'キャンペーン', '状態',
      ]);
    }
    sheet.appendRow([
      p.receivedAt || new Date(),
      p.company || '',
      p.name || '',
      p.email || '',
      p.tel || '',
      (p.interests || []).join(' / '),
      p.plan || '',
      p.message || '',
      (p.source && p.source.ref) || '',
      (p.source && p.source.utmCampaign) || '',
      p.status || 'NEW',
    ]);

    // ── 2) 気づける状態 ────────────────────────────
    if (notifyTo) {
      MailApp.sendEmail({
        to: notifyTo,
        subject: '【ガチャOS】問い合わせ ' + (p.company || p.name || ''),
        body: [
          '会社名 : ' + (p.company || '—'),
          'お名前 : ' + (p.name || '—'),
          'メール : ' + (p.email || '—'),
          '電話   : ' + (p.tel || '—'),
          '興味   : ' + ((p.interests || []).join(' / ') || '—'),
          'プラン : ' + (p.plan || '—'),
          '流入元 : ' + ((p.source && p.source.ref) || '—'),
          '',
          '── 本文 ──',
          p.message || '（本文なし）',
          '',
          '※この内容はスプレッドシートにも記録されています。',
        ].join('\n'),
      });
    }

    return json_({ ok: true });
  } catch (err) {
    // 失敗の理由に、お客様の氏名・メール・本文は絶対に載せない
    console.error('contact webhook failed: ' + err);
    return json_({ ok: false, reason: 'error' });
  }
}

/** ブラウザで開かれたときは、何も見せない */
function doGet() {
  return json_({ ok: false, reason: 'post_only' });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
