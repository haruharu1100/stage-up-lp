import fs from 'node:fs';
import path from 'node:path';
import { all, one, scalar } from '../lib/db/client';
import { config } from '../lib/env';
import { externalActionStatus } from '../lib/gate';
import { EXTERNAL_ACTIONS_IMPLEMENTED } from '../lib/env';
import { DEFAULT_SETTINGS, loadSettings } from '../lib/settings';
import { EXCLUSION_RULES } from '../lib/jobs/exclude';
import { listSitePolicies, TOS_RECHECK_DAYS } from '../lib/jobs/sites';
import { listLearnings } from '../lib/learning';
import { METRIC_DEFS } from '../lib/metrics';

/**
 * Obsidian（事業Vault）へ書き出す。
 *
 * ★書き出してよいのは「判断の根拠」と「結果の数字」だけ。
 *   APIキー・パスワード・お客さまの個人情報（電話番号・メールアドレス・担当者名）は書かない。
 *   Obsidianは同期先が増えるため、外に出た瞬間に取り消せないものは置かない。
 *
 * ★Obsidianが正本、このDBは写し。ただしこのファイルが書くのは
 *   「このOSが今どうなっているか」の記録であって、商品・道具の定義は上書きしない。
 */

const ROOT = path.join(config.obsidianVaultDir, 'AI営業受注OS');

/** 個人情報が混ざっていないかの最終確認。混ざっていたら書かずに止める。 */
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'メールアドレス', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { label: '電話番号', re: /(?:^|[^0-9])0\d{1,4}-\d{1,4}-\d{3,4}(?:[^0-9]|$)/ },
  { label: 'APIキーらしき文字列', re: /(sk-[A-Za-z0-9]{10,}|AIza[A-Za-z0-9_-]{10,})/ },
];

function assertSafe(name: string, body: string): void {
  for (const f of FORBIDDEN) {
    const m = body.match(f.re);
    if (m) throw new Error(`${name} に${f.label}が含まれている可能性があるため書き出しを中止しました（該当箇所の書式: ${m[0].slice(0, 3)}…）`);
  }
}

const written: string[] = [];

function write(name: string, body: string): void {
  assertSafe(name, body);
  fs.writeFileSync(path.join(ROOT, name), body.trimStart(), 'utf8');
  written.push(name);
}

function table(head: string[], rows: (string | number | null)[][]): string {
  const line = (cells: (string | number | null)[]) => `| ${cells.map((c) => (c === null || c === undefined ? '—' : String(c).replace(/\|/g, '／').replace(/\n/g, ' '))).join(' | ')} |`;
  return [line(head), `|${head.map(() => '---').join('|')}|`, ...rows.map(line)].join('\n');
}

const today = new Date().toISOString().slice(0, 10);

function head(title: string, lead: string): string {
  return `# ${title}\n\n> ${lead}\n>\n> 最終更新: ${today} ／ 自動生成（\`npm run obsidian:sync\`）。手で書き足した内容は次回の実行で消えます。\n\n`;
}

async function main() {
  if (!fs.existsSync(config.obsidianVaultDir)) {
    console.error(`事業Vaultが見つかりません: ${config.obsidianVaultDir}`);
    console.error('ORICOが接続されていない可能性があります。書き出しは行いません。');
    process.exit(1);
  }
  fs.mkdirSync(ROOT, { recursive: true });

  const settings = await loadSettings();
  const actions = externalActionStatus();
  const offers = await all('SELECT * FROM offers ORDER BY status, code');
  const caps = await all('SELECT * FROM capabilities ORDER BY status, code');
  const sites = await listSitePolicies();

  // ---------------------------------------------------------------- 00
  write(
    '00_MASTER.md',
    head('AI営業・案件自動受注OS｜正本', 'このフォルダがこのシステムの正本です。判断の根拠はここに置き、システム側はその写しを持ちます。') +
      `## このシステムは何をするか

- **SYSTEM A（法人営業）**: 会社を集める → 何をしている会社か読み取る → その会社に売るものを決める → 連絡手段を決める → 文面を作る → 反応を記録する
- **SYSTEM B（案件受注）**: 案件を集める → 中身を分解する → 自社の道具で作れるか照合する → 受けるか決める → 応募文を作る → 受注・制作・納品の準備をする

## 今の状態

- リリース段階: **Phase ${config.releasePhase}**（1=調べるだけ）
- 会社: ${await scalar('SELECT COUNT(*) FROM companies')}社 ／ 案件: ${await scalar('SELECT COUNT(*) FROM jobs')}件
- 実際に送信した営業: **${await scalar('SELECT COUNT(*) FROM outreach_logs WHERE executed = 1')}件**
- 実際に応募した案件: **${await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1')}件**

## 外部への操作（送信・応募・納品）

外部に影響が出る操作は、スイッチを切っているだけではありません。**実行する処理コードそのものを置いていません。**
スイッチをONに書き換えても、送信は起きません（送る関数が存在しないため）。

${table(
  ['操作', 'スイッチ', '実行する処理コード'],
  actions.map((a) => [a.label, a.flagOn ? 'ON' : 'OFF', a.implemented ? 'あり' : 'なし']),
)}

実装フラグ: \`EXTERNAL_ACTIONS_IMPLEMENTED = ${EXTERNAL_ACTIONS_IMPLEMENTED}\`
この値を true にする変更は、必ず差分に現れます（型が \`false\` 固定のため）。

## 判断の優先順位

1. 法令・規約を破らない（破るくらいなら受けない・送らない）
2. 不明なものは通さない（「たぶん大丈夫」で自動実行しない）
3. 取れなかったデータを0にしない（0円ではなく「未確認」と書く）
4. 少ない件数で数字を動かさない（${settings.get('learning.min_samples') ?? 20}件たまるまで初期値のまま）

## 固定ルール（変更する場合は人の判断が必要）

- 1日8時間拘束・常駐・正社員・時給労働中心の案件は自動で除外する
- 危険・不明な応募は自動で行わず、1クリック承認へ回す
- CAPTCHA等の仕組みは回避しない。自動で通せないものは人へ回す
- 同じ会社へ重複して営業しない（${settings.get('sales.reapproach_days') ?? 90}日空ける）
`,
  );

  // ---------------------------------------------------------------- 01
  write(
    '01_Architecture.md',
    head('全体の作り', '何がどの順で動くか。ここを読めば、どこを直せばどこが変わるかが分かります。') +
      `## 処理の流れ

\`\`\`
[SYSTEM A]
会社を集める → 汚れたデータを落とす → 会社を読み取る → 売るものを決める
   → 点数をつける → 連絡手段を決める → 文面を作る → 関門 → 記録（送信はしない）

[SYSTEM B]
案件を集める → 受けない案件を落とす → 中身を分解する → 自社の道具と照合
   → 点数と利益を出す → 応募文を作る → サイト規約を見る → 関門 → 記録（応募はしない）
\`\`\`

## 関門（guard）は必ず最後に通る

どちらの流れも、最後に「関門」を通ります。関門は次を全部確認し、1つでも欠けたら止めます。

- 営業お断りの表記がある会社ではないか
- NG名簿・お断りの返信を受けていないか
- 同じ会社・同じ運営者に重複していないか
- 会社情報が古すぎないか（取得から日数）
- 連絡先そのものが有効か
- 1日の上限を超えていないか
- **外部への操作コードが存在するか（＝常に存在しないので必ずここで止まる）**

## 保管場所

- 正本（判断の根拠）: このフォルダ
- 写し（動かすためのデータ）: \`ai-sales-os/data/sales.db\`（Gitに入れない）
- 秘密の値: \`ai-sales-os/.env\`（Gitに入れない・Obsidianにも書かない）
`,
  );

  // ---------------------------------------------------------------- 02
  write(
    '02_販売商品.md',
    head('売れるもの', '会社に売る商品の一覧。出典ファイルが消えると自動で「停止」に落ちます（根拠の消えたものを売りに行かせないため）。') +
      table(
        ['商品', '分類', '状態', '価格', '出典', '状態の理由'],
        offers.map((o) => [
          String(o.name),
          String(o.category),
          String(o.status),
          o.price_min === null && o.price_max === null ? '未確認' : `${Number(o.price_min ?? 0).toLocaleString()}円〜${o.price_max === null ? '' : `${Number(o.price_max).toLocaleString()}円`}`,
          String(o.evidence_path ?? '—'),
          o.status_reason ? String(o.status_reason) : '—',
        ]),
      ) +
      `

## 決めていること

- 価格が分からない商品は0円ではなく**空欄**にする。仮の数字で期待値を計算すると、間違った相手に営業してしまうため。
- 商品は固定しない。会社ごとに「今この会社に売るべきもの」を選び直す。
`,
  );

  // ---------------------------------------------------------------- 03
  write(
    '03_既存AI.md',
    head('できること（過去に作ったAI・システム）', '案件を受けるかどうかは、ここにある道具で足りるかどうかで決めます。') +
      table(
        ['道具', '種類', '状態', '1単位の想定時間', '自動化', '出典'],
        caps.map((c) => [
          String(c.name),
          String(c.kind),
          String(c.status),
          c.unit_hours === null ? '—' : `${Number(c.unit_hours)}h / ${c.unit_label ?? '1件'}`,
          c.automation_rate === null ? '—' : `${Math.round(Number(c.automation_rate) * 100)}%`,
          String(c.evidence_path ?? '—'),
        ]),
      ) +
      `

## 決めていること

- **新しく作らない。** すでに作ったものが当たる案件だけを取りに行く。
- 「開発中」の道具は当てにしない。受注可能性の計算に入れない。
- 道具が1つも当たらない案件は、手作業として多めに見積もる（割に合わないことを見えるようにするため）。
`,
  );

  // ---------------------------------------------------------------- 04
  write(
    '04_対応可能業務.md',
    head('対応できる作業の種類', '案件文からこの種類を拾い、上の道具と突き合わせます。') +
      `${table(
        ['作業の種類', '内容'],
        [
          ['調査・情報収集', 'リサーチ／市場調査／競合調査／営業リスト'],
          ['文章作成', '記事／コピー／キャッチ／商品説明文／台本／シナリオ'],
          ['画像・デザイン', 'バナー／サムネイル／画像生成／イラスト'],
          ['構築・実装', 'サイト制作／LP制作／WordPress／GAS／スプレッドシート／システム開発'],
          ['運用・投稿', 'SNS運用／投稿代行／更新／管理代行'],
          ['分析・集計', 'データ分析／集計／レポート作成'],
        ],
      )}

## 積極的に受ける

キャッチコピー／SNS投稿・X投稿／ブログ・SEO記事／商品説明／LP／営業文章／画像生成／AI導入支援／GAS／Webシステム／WordPress／EC・Amazon支援／データ分析／営業リスト作成／市場調査／動画台本

## 受けない（自動で除外）

${table(
  ['除外の理由', 'なぜ受けないか'],
  EXCLUSION_RULES.map((r) => [r.label, r.why]),
)}
`,
  );

  // ---------------------------------------------------------------- 05
  const byIndustry = await all(`
    SELECT a.industry AS industry, COUNT(*) AS n,
           SUM(CASE WHEN d.channel = 'PHONE' THEN 1 ELSE 0 END) AS phone,
           SUM(CASE WHEN d.channel = 'EMAIL' THEN 1 ELSE 0 END) AS email,
           SUM(CASE WHEN d.channel = 'FORM'  THEN 1 ELSE 0 END) AS form,
           SUM(CASE WHEN d.channel IN ('SKIP','MANUAL') THEN 1 ELSE 0 END) AS skip
    FROM company_analyses a
    LEFT JOIN channel_decisions d ON d.company_id = a.company_id
    GROUP BY a.industry ORDER BY n DESC`);
  write(
    '05_業種別営業.md',
    head('業種ごとの営業', '業種によって、刺さる話も連絡手段も変わります。実績が溜まったらここを実測値で書き換えます。') +
      table(
        ['業種', '会社数', '電話', 'メール', 'フォーム', '営業しない'],
        byIndustry.map((r) => [String(r.industry), Number(r.n), Number(r.phone), Number(r.email), Number(r.form), Number(r.skip)]),
      ) +
      `

## 決めていること

- 業種ごとに話す内容を変える。同じ台本を使い回さない。
- どの業種が取れるかは、まだ実績がないので**判断できない**。憶測で優先順位をつけない。
`,
  );

  // ---------------------------------------------------------------- 06〜08
  write(
    '06_電話営業.md',
    head('電話営業', '台本の作り方と、やらないこと。※実際に電話をかける処理はこのシステムに存在しません。') +
      `## 台本の構成

1. 名乗り（会社名・自分の名前・要件が何秒で終わるか）
2. 用件（その会社のHPを読んで分かったことを最低1つ入れる）
3. 聞くこと（今どうしているか。困っているか）
4. 断られたときの返し（食い下がらない。次につながる形で切る）
5. 終わり方（資料を送る／またの機会に）

## やらないこと

- 同じ台本を全社に使い回す
- 営業お断りと書いてある会社にかける
- 断られた相手にかけ直す
- 時間帯を考えずにかける

## 現在の状態

- スイッチ: ${actions.find((a) => a.action === 'CALL')?.flagOn ? 'ON' : 'OFF'} ／ 実行する処理コード: なし
- 用意した台本: ${await scalar('SELECT COUNT(*) FROM call_scripts')}件
- 実際にかけた件数: **0件**
`,
  );

  write(
    '07_メール営業.md',
    head('メール営業', '特定電子メール法で必要な項目と、文面の作り方。※実際に送信する処理はこのシステムに存在しません。') +
      `## 法律で必ず入れる4項目（1つでも欠けたら文面を作らない）

1. 送信者の氏名または名称
2. 送信者の住所
3. 問い合わせを受け付けるメールアドレス等
4. 受信拒否（オプトアウト）の通知先

これらは \`.env\` に設定します。**Obsidianには書きません**（設定されているかどうかは管理画面で確認できます）。

## 文面のルール

- 会社ごとに個別に書く。**大量コピペは禁止**
- その会社のHPを読んで分かったことを**最低1つ以上**入れる
- 他社宛ての文面と似すぎている場合（個別化した部分の類似度が上限超え）は自動で止める
- 「必ず儲かる」「絶対」などの断定・誇大な表現は自動で止める（景表法）

## 現在の状態

- スイッチ: ${actions.find((a) => a.action === 'EMAIL')?.flagOn ? 'ON' : 'OFF'} ／ 実行する処理コード: なし
- 実際に送った件数: **0件**
`,
  );

  write(
    '08_フォーム営業.md',
    head('問い合わせフォーム営業', 'フォームは自動送信しません。人が内容を見て、自分で送ります。') +
      `## 絶対に守ること

1. **CAPTCHA（認証画像）などの仕組みは回避しない。** 回避は不正アクセスにあたる可能性があり、事業ごと失う。
2. 自動で通せない場合は、必ず**1クリック承認キュー**へ回す。
3. 「営業お断り」と書かれている会社は、フォームがあっても外す。
4. 1社につき1件だけ。同じ会社を何度も承認待ちに並べない。

## 現在の状態

- スイッチ: ${actions.find((a) => a.action === 'FORM')?.flagOn ? 'ON' : 'OFF'} ／ 実行する処理コード: なし
- 承認待ち: ${await scalar("SELECT COUNT(*) FROM approval_queue WHERE kind = 'FORM' AND status = 'PENDING'")}件
- 実際に送信した件数: **0件**
`,
  );

  // ---------------------------------------------------------------- 09
  write(
    '09_会社評価.md',
    head('会社の評価のしかた', '何を見て点数をつけているか。ここを変えたら必ずバックテストで数字を比べます。') +
      `${table(
        ['見ているもの', '中身'],
        [
          ['SALES_MATCH（商品との相性）', 'その会社の業種・事業内容と、売る商品が噛み合っているか'],
          ['NEED（困りごと）', '人手不足／営業／予約／電話対応／EC／広告／顧客管理のどこに困っていそうか'],
          ['BUDGET（払えそうか）', '規模・資本金・従業員数などから見た支払い余力'],
          ['CONTACTABILITY（連絡のつけやすさ）', '電話・メール・フォームのどれが使えるか'],
          ['CLOSE_PROBABILITY（成約しそうか）', '上の組み合わせから見た成約の見込み'],
          ['EXPECTED_VALUE（期待値）', '予想契約金額 × 成約確率 ÷ 営業コスト'],
        ],
      )}

## 決めていること

- **期待値が出せないときは0にしない。** 空欄にして「なぜ出せないか」を書く。
  0にすると「金額が分からないだけの有望な会社」が下に沈んで永久に消えるため。
- そのため、期待値とは別に**点数だけの優先順位**も持っている。
- 成約確率の初期値は仮置き。実績が${settings.get('learning.min_samples') ?? 20}件たまるまで動かさない。
`,
  );

  // ---------------------------------------------------------------- 10
  write(
    '10_求人サイト規約.md',
    head('案件サイトの規約台帳', 'SYSTEM Bで一番大事な場所。「たぶん大丈夫」で自動応募すると、アカウントごと失います。') +
      `## 規則

1. 人が規約の該当箇所を読んで、**原文・URL・確認日**を入れるまで、判定は UNKNOWN のまま。
2. **UNKNOWN は「安全」ではない。** UNKNOWN は自動応募しない（承認キューへ回す）。
3. 規約は変わる。確認から**${TOS_RECHECK_DAYS}日**過ぎたら UNKNOWN に戻す。

${table(
  ['サイト', '自動応募の判定', '判定の理由', '確認日', '根拠URL'],
  sites.map((s) => [s.name, s.effectivePolicy, s.reasonJa, s.checkedAt ? s.checkedAt.slice(0, 10) : '未確認', s.evidenceUrl ?? '—']),
)}

## 今の結論

全サイトが「規約を人が確認していない」状態です。したがって**自動応募は1件も行いません**。
確認を入れるまで、応募候補はすべて1クリック承認へ回ります。これは正常な状態です。
`,
  );

  // ---------------------------------------------------------------- 11
  write(
    '11_案件評価基準.md',
    head('案件の評価のしかた', '短時間・高単価・自社のAIが使えるものを優先します。') +
      `${table(
        ['見ているもの', '中身'],
        [
          ['MATCH（できるか）', '自社の道具が当たるか'],
          ['PROFIT（儲かるか）', '想定報酬 − かかる費用'],
          ['WIN（取れそうか）', '応募数・実績要件などから見た受注の見込み'],
          ['AUTOMATION（自動化できるか）', '当たった道具の自動化率'],
          ['EFFORT（手間）', '想定作業時間'],
          ['RISK（危険度）', '規約・法令・炎上の恐れ'],
        ],
      )}

## 想定作業時間の出し方

当たった道具の想定時間を足したうえで、**どの案件にも必ずかかる時間（0.5時間）を足します**。
依頼文を読む・確認のやりとり・出来上がりの点検・受け渡し・1回分の手直しの分です。
これを入れないと、AIが生成する時間だけで「数分で終わる案件」に見え、時間あたりの利益が実態からかけ離れます。

分量（本数・記事数）は、そのまま掛け算しません。1件目は準備込みの合計、2件目以降はいちばん重い作業の6割で数えます。
準備を件数分くり返す計算にすると、本来受けられる案件まで赤字に見えてしまうためです。

## 予算が書かれていない案件

時給を**0円にせず、空欄**にして人が見ます。0円にすると「割に合わない案件」として自動で捨ててしまうためです。
`,
  );

  // ---------------------------------------------------------------- 12
  const routes = await all('SELECT action, COUNT(*) AS n FROM applications GROUP BY action');
  write(
    '12_応募.md',
    head('応募', '応募文の作り方と、応募の行き先。※実際に応募する処理はこのシステムに存在しません。') +
      `## 応募文のルール

- 案件ごとに完全に個別で書く。**テンプレ丸出しは禁止**
- 他の応募文と似すぎている場合（個別化した部分の類似度が上限超え）は自動で止める
- **AI利用が禁止されている案件には応募しない**（AIを使えない仕事は時間だけが消える）
- 見積り金額を必ず入れる

## 応募の行き先

${table(['行き先', '件数'], routes.map((r) => [String(r.action), Number(r.n)]))}

- AUTO_ALLOWED（規約上OK）… 自動応募してよいサイト。※現在0件（規約未確認のため）
- APPROVAL_REQUIRED / UNKNOWN … 1クリック承認へ
- PROHIBITED … 応募しない

## 現在の状態

- スイッチ: ${actions.find((a) => a.action === 'APPLY')?.flagOn ? 'ON' : 'OFF'} ／ 実行する処理コード: なし
- 実際に応募した件数: **0件**
`,
  );

  // ---------------------------------------------------------------- 13〜14
  const orders = await all('SELECT status, COUNT(*) AS n, SUM(amount) AS amt FROM orders GROUP BY status');
  write(
    '13_受注.md',
    head('受注から納品まで', '受けたあとの流れ。納品の直前に必ず人の確認が入ります。') +
      `## 流れ

1. 案件を分析する
2. 作業を分解する
3. 使う道具（既存のAI・システム）を選ぶ
4. 作る
5. 自分で見直す（セルフレビュー）
6. 別のAIで見直す（景表法・誇大表現・事実誤りを見る）
7. 直す
8. **人が確認する（必須。ここを飛ばせない）**
9. 納品の準備（※納品そのものを実行する処理は存在しません）

${table(['状態', '件数', '金額'], orders.map((o) => [String(o.status), Number(o.n), o.amt === null ? '—' : `${Number(o.amt).toLocaleString()}円`]))}

## 決めていること

- 作ったものは**自動で「納品してよい」にならない**。人が確認して初めて納品待ちになる。
- 見直しで問題が残っているものは、人間確認済みにできない。
`,
  );

  const lost = await all("SELECT lost_reason, COUNT(*) AS n FROM deals WHERE stage = 'LOST' GROUP BY lost_reason ORDER BY n DESC");
  write(
    '14_失注.md',
    head('失注', 'なぜ断られたか。ここが溜まるほど、次に何を直せばよいかが分かります。') +
      (lost.length === 0
        ? '失注の記録はまだありません。営業を実行していないため、これは正常な状態です。\n'
        : table(['理由', '件数'], lost.map((r) => [String(r.lost_reason ?? '不明'), Number(r.n)]))),
  );

  // ---------------------------------------------------------------- 15
  const rev = await one('SELECT SUM(amount) AS amt, SUM(cost) AS cost, SUM(actual_hours) AS hours FROM orders');
  write(
    '15_利益分析.md',
    head('利益', '予測の金額は入れません。実際に受けた・納めたものだけを数えます。') +
      `${table(
        ['項目', '値'],
        [
          ['受注の合計金額', rev?.amt === null || rev?.amt === undefined ? '—' : `${Number(rev.amt).toLocaleString()}円`],
          ['かかった費用', rev?.cost === null || rev?.cost === undefined ? '—' : `${Number(rev.cost).toLocaleString()}円`],
          ['かかった時間', rev?.hours === null || rev?.hours === undefined ? '—' : `${Number(rev.hours)}時間`],
        ],
      )}

## 計算に使っている費用の前提（**すべてまだ実測ではなく仮置き**）

${table(
  ['項目', '値', '説明'],
  DEFAULT_SETTINGS.filter((d) => d.key.startsWith('cost.') || d.key.startsWith('job.')).map((d) => [d.label, String(settings.get(d.key) ?? d.value), d.hint ?? '—']),
)}

実際に営業・受注をしたら、ここを実測値へ置き換えます。それまでこの数字を根拠に判断を広げません。
`,
  );

  // ---------------------------------------------------------------- 16
  const backtests = await all('SELECT name, dataset, metrics, run_at FROM backtests ORDER BY id DESC LIMIT 20');
  write(
    '16_Backtest.md',
    head('バックテスト', '仕組みを変えたら必ずここで測ります。「良くなった気がする」では判断しません。') +
      `## 測っているもの

${table(['数字', '良い方向'], METRIC_DEFS.map((m) => [m.label, m.want === 'up' ? '大きいほど良い' : m.want === 'down' ? '小さいほど良い' : '増減で良し悪しを決めない']))}

## 履歴

${
        backtests.length === 0
          ? 'まだ測定していません。'
          : table(
              ['測定日時', '変更内容', '対象データ', '応募したい案件の平均時給', '実際に送信', '実際に応募'],
              backtests.map((b) => {
                const m = JSON.parse(String(b.metrics)) as Record<string, number>;
                return [
                  String(b.run_at).slice(0, 16).replace('T', ' '),
                  String(b.name),
                  String(b.dataset),
                  `${(m.job_hourly_avg ?? 0).toLocaleString()}円`,
                  m.executed_outreach ?? 0,
                  m.executed_applications ?? 0,
                ];
              }),
            )
      }

## 読み方の注意

数字が下がった＝悪化、とは限りません。**間違っていた数字が正しくなった場合も下がります。**
例: 「応募したい案件の平均時給」が 77,595円 → 28,835円 に下がった変更は、
案件の想定時間にどの案件にもかかる手間（0.5時間）を足したことによるものです。
それ以前の 77,595円 は、AIが生成する時間だけを数えていたための過大な数字でした。
下がった理由が「測り方が正しくなった」なのか「選び方が悪くなった」なのかを、必ず区別して記録します。
`,
  );

  // ---------------------------------------------------------------- 17
  write(
    '17_Experiments.md',
    head('実験の予定', '何を変えたら何が良くなるかを、1つずつ測って決めます。まとめて変えると原因が分からなくなります。') +
      `${table(
        ['実験', '変えるもの', '見る数字', '状態'],
        [
          ['EXP-001 文面の個別化を強くする', 'HPから引く事実の数を1→2にする', '使える文面の割合／使い回し度合い', '未実施'],
          ['EXP-002 連絡手段の優先順位', 'フォーム優先／電話優先を入れ替える', '返信率（実績が必要）', '実績待ち'],
          ['EXP-003 案件の絞り込み', '時間あたり利益の下限を上げる', '応募したい案件の平均時給／件数', '未実施'],
          ['EXP-004 想定時間の精度', '固定の手間0.5時間を実測に置き換える', '実際の時間あたり利益', '実績待ち'],
        ],
      )}

実験は**1回に1つだけ**変えます。変えたら \`npm run backtest\` で前後を比べ、16_Backtest に残します。
`,
  );

  // ---------------------------------------------------------------- 18〜19
  const logs = await all('SELECT step, status, detail, created_at FROM run_logs ORDER BY id DESC LIMIT 30');
  write(
    '18_変更履歴.md',
    head('動かした記録', 'いつ何を動かしたか（新しい順に30件）。') +
      (logs.length === 0
        ? '記録はありません。\n'
        : table(
            ['日時', '処理', '結果', '内容'],
            logs.map((l) => [String(l.created_at).slice(0, 16).replace('T', ' '), String(l.step), String(l.status), l.detail ? String(l.detail) : '—']),
          )),
  );

  const errors = await all("SELECT step, detail, created_at FROM run_logs WHERE status = 'ERROR' ORDER BY id DESC LIMIT 30");
  write(
    '19_障害.md',
    head('障害', '止まった・失敗したこと。原因と対策をここに残します。') +
      (errors.length === 0
        ? '記録された障害はありません。\n\n## 見つかって直した問題（人が気づいたもの）\n\n' +
          table(
            ['見つかった問題', 'なぜ起きたか', 'どう直したか'],
            [
              [
                '案件の時間あたり利益が32万円/時と出ていた',
                '想定作業時間にAIの生成時間しか入れておらず、依頼文を読む・確認する・受け渡す時間が0だった',
                'どの案件にもかかる0.5時間を必ず足すようにした',
              ],
              [
                '同じ会社が何度も承認待ちに並んだ',
                'フォーム営業だけ重複チェックを通していなかった',
                '外部への関門以外の理由で止まっている会社は、人にも見せないようにした',
              ],
              [
                '人が押した「却下」が消えた',
                '処理をやり直すたびに承認待ちの状態を未判断へ戻していた',
                '一度判断したものは二度と書き換えないようにした',
              ],
              [
                '1日の上限が、営業していない会社を見ただけで埋まった',
                '「見送った」記録も上限に数えていた',
                '実際の営業予定（送る予定・承認待ち）だけを数えるようにした',
              ],
            ],
          ) +
          '\n'
        : table(
            ['日時', '処理', '内容'],
            errors.map((l) => [String(l.created_at).slice(0, 16).replace('T', ' '), String(l.step), l.detail ? String(l.detail) : '—']),
          )),
  );

  // ---------------------------------------------------------------- 20
  const learnings = await listLearnings();
  const measured = learnings.filter((l) => l.verdict === 'MEASURED');
  write(
    '20_Learnings.md',
    head('学んだこと', 'AIの推測でスコアを動かしません。実績が最低件数に届いた区分だけ、実測に切り替えます。') +
      `- 見ている区分: ${learnings.length}件
- 実測に切り替わった区分: **${measured.length}件**
- 切り替えに必要な件数: ${settings.get('learning.min_samples') ?? 20}件

${
        measured.length === 0
          ? 'まだ実績がないため、すべての区分が「判断できない」です。**これは正常な状態です。**\n少ない件数で数字を動かすと、たまたまの結果を法則だと思い込んでしまいます。\n'
          : table(
              ['対象', '区分', '値', '実績', 'うち成功', '成功率'],
              measured.map((l) => [l.scope, l.dimension, l.key, l.samples, l.wins, l.win_rate === null ? '—' : `${(l.win_rate * 100).toFixed(1)}%`]),
            )
      }

## 仕組みとして分かっていること（実績を待たずに確定していること）

- 不明（UNKNOWN）を安全扱いにすると、規約違反の自動応募が起きる。UNKNOWNは必ず人へ回す。
- 取れなかったデータを0にすると、有望なものが下に沈んで消える。0ではなく空欄にする。
- 想定作業時間に固定の手間を入れないと、時間あたり利益が実態からかけ離れる。
- 重複チェックを1か所でも飛ばすと、そこから重複営業が漏れる（フォーム営業で実際に起きた）。
`,
  );

  console.log(`■ Obsidianへ書き出しました: ${ROOT}`);
  for (const f of written) console.log(`  ・${f}`);
  console.log('');
  console.log('■ 書き出していないもの（意図的に）');
  console.log('  ・APIキー / パスワード / .env の中身');
  console.log('  ・会社の電話番号・メールアドレス・担当者名');
  console.log('  → 書き出す直前に文字列を検査し、混ざっていたら中止します。');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
