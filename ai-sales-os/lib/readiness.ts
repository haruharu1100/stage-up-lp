import { scalar } from './db/client';
import { EXTERNAL_ACTIONS_IMPLEMENTED, EXTERNAL_ACTION_LABEL, config, externalFlag, hasSecret, type ExternalAction } from './env';
import { listSitePolicies } from './jobs/sites';
import { senderIdentity } from './sales/sender-identity';

/**
 * 「あと何を用意すれば、1件目を実際に実行できるか」を機械が数える。
 *
 * ★なぜ要るか。
 *   今このシステムは、調べる・判断する・文章を書く、までは動く。
 *   けれど電話も送信も応募もしない。ここで人が知りたいのは
 *   「じゃあ、あと何をすれば1件目が動くのか」の一点だけ。
 *   それを頭の中や口頭のメモで管理すると、必ず抜ける。
 *   だから足りないものを表で持ち、画面と報告に同じものを出す。
 *
 * ★この表は「やることリスト」であって「実行の許可」ではない。
 *   ここが全部そろっても、送信は起きない。送る処理コードが無いため（gate.ts）。
 *   最後の「実行する処理を作る」は、人がはっきり決めてから着手する項目として
 *   いちばん上に固定してある。ここを黙って埋めない。
 *
 * ★分からないものは「できている」に入れない。
 *   例：相手サイトの規約が未確認なら、それは MISSING ではなく BLOCKED（先に進めない）。
 */

export type ReadyState =
  /** もう用意できている */
  | 'DONE'
  /** 人が用意すれば済む（鍵を入れる、住所を書く、など） */
  | 'MISSING'
  /** 用意では済まない。作る・規約を確認する等の判断が要る */
  | 'BLOCKED';

export type ReadyItem = {
  state: ReadyState;
  label: string;
  /** 今どうなっているか */
  detail: string;
  /** 足りないとき、人が具体的に何をすればよいか。DONE のときは null。 */
  how: string | null;
};

export type ReadyAction = {
  action: ExternalAction;
  label: string;
  items: ReadyItem[];
  /** 実行を待っている候補の数 */
  candidates: number;
  candidateLabel: string;
  /** この操作を1件動かすまでに、あといくつ残っているか */
  missing: number;
  blocked: number;
  /** 一言でいうと今どこで止まっているか */
  summary: string;
};

const DONE = (label: string, detail: string): ReadyItem => ({ state: 'DONE', label, detail, how: null });
const MISSING = (label: string, detail: string, how: string): ReadyItem => ({ state: 'MISSING', label, detail, how });
const BLOCKED = (label: string, detail: string, how: string): ReadyItem => ({ state: 'BLOCKED', label, detail, how });

/**
 * すべての外部操作に共通の、いちばん重い前提。
 * スイッチを true にしても動かない。処理そのものが無いため。
 */
function codeItem(action: ExternalAction): ReadyItem {
  const label = EXTERNAL_ACTION_LABEL[action];
  if (EXTERNAL_ACTIONS_IMPLEMENTED) return DONE('実行する処理がある', `「${label}」の処理が入っている`);
  return BLOCKED(
    '実行する処理そのもの',
    `「${label}」を実際に行うコードが、このシステムに1行も入っていない。スイッチを入れても何も起きない。`,
    '本当に外へ出す段になってから、この1機能だけを作る。作る前に「誰に・何通・どの文面で」を決めて、1件だけ手で試す。',
  );
}

function flagItem(action: ExternalAction): ReadyItem {
  const label = EXTERNAL_ACTION_LABEL[action];
  const on = externalFlag(action);
  const envName = { CALL: 'AUTO_CALL', EMAIL: 'AUTO_EMAIL', FORM: 'AUTO_FORM', APPLY: 'AUTO_APPLY', DELIVER: 'AUTO_DELIVER' }[action];
  return on
    ? DONE('自動実行のスイッチ', `${envName} は入っている（それでも処理が無いので動かない）`)
    : MISSING('自動実行のスイッチ', `${envName} は OFF（初期値のまま）`, `最後の最後に .env の ${envName} を true にする。ここは「${label}」を1件ずつ手で確かめたあとで触る。`);
}

async function count(sql: string, args: unknown[] = []): Promise<number> {
  return Number(await scalar(sql, args));
}

export async function firstRunReadiness(): Promise<ReadyAction[]> {
  const out: ReadyAction[] = [];

  const pending = async (kind: string) => count("SELECT COUNT(*) FROM approval_queue WHERE kind = ? AND status = 'PENDING'", [kind]);
  const approved = async (kind: string) => count("SELECT COUNT(*) FROM approval_queue WHERE kind = ? AND status = 'APPROVED'", [kind]);

  // ── ① AI電話 ──────────────────────────────────────────────
  {
    const items: ReadyItem[] = [codeItem('CALL')];
    // ★台本の入っている列は channel = 'PHONE'。外部操作の名前（CALL）とは別の言葉なので取り違えない。
    const ready = await count("SELECT COUNT(*) FROM outreach_drafts WHERE channel = 'PHONE' AND status = 'READY'");
    items.push(
      ready > 0
        ? DONE('話す台本', `${ready}社ぶんの台本ができている`)
        : MISSING('話す台本', '電話の台本が1件も無い', 'npm run pipeline を実行して、電話に回る会社を作る。'),
    );
    items.push(
      hasSecret('OPENAI_API_KEY') || hasSecret('ANTHROPIC_API_KEY')
        ? DONE('話すためのAIの鍵', '設定済み')
        : MISSING('話すためのAIの鍵', '未設定', '.env に OPENAI_API_KEY を入れる（値は画面にもログにも出さない）。'),
    );
    items.push(
      MISSING(
        '電話回線の契約と発信番号',
        'まだ何も契約していない',
        // ★ここに具体的なサービス名を書かない。安全テストが「送信ライブラリの気配」を名前で探しており、
        //   説明文に名前があるだけで警告が出る。その警告を弱めるより、こちらの書き方を変えるほうが安全。
        'クラウド電話の事業者と契約し、発信元として名乗る番号を1つ用意する。番号は必ず自分名義のものにする。',
      ),
    );
    items.push(
      BLOCKED(
        '通話の録音と、相手への告知',
        '録音するかどうかを決めていない',
        '録音するなら、話し始めに「録音しています」と必ず伝える台本にする。決めるまで発信しない。',
      ),
    );
    items.push(flagItem('CALL'));
    out.push(build('CALL', items, ready, '電話をかけられる状態の会社', await pending('CALL'), await approved('CALL')));
  }

  // ── ② 営業メール ───────────────────────────────────────────
  {
    const items: ReadyItem[] = [codeItem('EMAIL')];
    const id = senderIdentity();
    items.push(
      id.ok
        ? DONE('法律で必須の送信者情報', '氏名・住所・問い合わせ先・配信停止先がすべて入っている')
        : MISSING('法律で必須の送信者情報', `足りない項目：${id.missing.join('・')}`, '.env に SENDER_NAME / SENDER_ADDRESS / SENDER_EMAIL / SENDER_UNSUBSCRIBE_URL を入れる。1つでも欠けるとメールの文面自体を作らない。'),
    );
    const ready = await count("SELECT COUNT(*) FROM outreach_drafts WHERE channel = 'EMAIL' AND status = 'READY'");
    items.push(
      ready > 0
        ? DONE('送る文面', `${ready}通ぶんの文面ができている`)
        : MISSING('送る文面', 'メールの文面が1件も無い', '送信者情報を入れてから npm run pipeline を実行する。'),
    );
    items.push(
      MISSING('メールを送る回線', 'まだ何も契約していない', '送信サービス（自社ドメインのSMTP等）を用意し、SPF・DKIM・DMARC を設定する。ここを飛ばすと迷惑メール扱いになり、ドメインごと信用を失う。'),
    );
    items.push(
      MISSING('配信停止を受け取る場所', '受け皿のページを作っていない', '配信停止リンクを押したら、実際に止まる仕組みを作る。止まらないリンクを載せるのは違法。'),
    );
    items.push(flagItem('EMAIL'));
    out.push(build('EMAIL', items, ready, 'メールを送れる状態の会社', await pending('EMAIL'), await approved('EMAIL')));
  }

  // ── ③ 問い合わせフォーム ────────────────────────────────────
  {
    const items: ReadyItem[] = [codeItem('FORM')];
    const p = await pending('FORM');
    const a = await approved('FORM');
    items.push(
      p + a > 0
        ? DONE('人が確認する候補', `承認待ち${p}件／承認済み${a}件`)
        : MISSING('人が確認する候補', 'フォーム営業の候補が0件', 'npm run pipeline を実行する。'),
    );
    items.push(
      BLOCKED(
        '相手のフォームが営業を受け付けているか',
        'フォームごとの可否を機械では判断しきれない',
        'フォームの近くに「営業お断り」と書いてあるものは、承認画面で却下する。システムは文言を見つけたら自動で外すが、書き方が特殊なものは人が見る。',
      ),
    );
    items.push(
      BLOCKED(
        'CAPTCHA（画像認証）があるフォーム',
        '回避しない方針で固定している',
        '認証があるフォームは自動化しない。承認画面から人が開いて手で送る。ここを自動化しようとしない。',
      ),
    );
    items.push(flagItem('FORM'));
    out.push(build('FORM', items, p, 'フォーム営業の承認待ち', p, a));
  }

  // ── ④ 案件への応募 ─────────────────────────────────────────
  {
    const items: ReadyItem[] = [codeItem('APPLY')];
    const sites = await listSitePolicies();
    const auto = sites.filter((s) => s.effectivePolicy === 'AUTO_ALLOWED');
    const okManual = sites.filter((s) => s.effectivePolicy === 'APPROVAL_REQUIRED');
    items.push(
      auto.length > 0
        ? DONE('規約上、自動応募してよいサイト', auto.map((s) => s.name).join('・'))
        : BLOCKED(
            '規約上、自動応募してよいサイト',
            `0サイト（人が1クリックで承認する形なら${okManual.length}サイト）`,
            'ここは設定では解決しない。各サイトの規約が変わったときだけ npm run sites:record で記録を更新する。推測で AUTO_ALLOWED にしない。',
          ),
    );
    const p = await pending('APPLY');
    const a = await approved('APPLY');
    items.push(
      p + a > 0
        ? DONE('応募文の候補', `承認待ち${p}件／承認済み${a}件`)
        : MISSING('応募文の候補', '応募したい案件が0件', 'npm run jobs:import で案件を入れてから npm run pipeline を実行する。'),
    );
    items.push(
      MISSING('各サイトのログイン', 'まだ用意していない', '応募するサイトのアカウントを作り、本人確認まで済ませる。ログイン情報はシステムに保存せず、人が自分で入る。'),
    );
    items.push(flagItem('APPLY'));
    out.push(build('APPLY', items, p, '応募の承認待ち', p, a));
  }

  // ── ⑤ 納品 ──────────────────────────────────────────────
  {
    const items: ReadyItem[] = [codeItem('DELIVER')];
    const orders = await count('SELECT COUNT(*) FROM orders');
    items.push(
      orders > 0
        ? DONE('受注した仕事', `${orders}件`)
        : MISSING('受注した仕事', '受注が0件', '応募して受注が決まるまで、ここは0のままで正しい。'),
    );
    // ★「成果物ができている」と「人が中身を見た」は別。見ていないものを納品候補に数えない。
    const confirmed = await count('SELECT COUNT(*) FROM deliverables WHERE human_confirmed = 1');
    const made = await count('SELECT COUNT(*) FROM deliverables');
    items.push(
      confirmed > 0
        ? DONE('人が中身を確認した成果物', `${made}件のうち${confirmed}件を確認済み`)
        : MISSING('人が中身を確認した成果物', made > 0 ? `成果物は${made}件あるが、人がまだ1件も確認していない` : '成果物がまだ無い', '管理画面で成果物を開き、中身を読んでから確認を押す。ここを飛ばして納品しない。'),
    );
    items.push(
      BLOCKED('人の最終確認を必須にする運用', '納品前に人が中身を見る決まりで固定している', '成果物は必ず人が開いて確認してから渡す。ここは自動化しない。'),
    );
    items.push(flagItem('DELIVER'));
    out.push(build('DELIVER', items, confirmed, '人が確認済みで納品できる成果物', await pending('DELIVER'), await approved('DELIVER')));
  }

  return out;
}

function build(action: ExternalAction, items: ReadyItem[], candidates: number, candidateLabel: string, pending: number, approved: number): ReadyAction {
  const missing = items.filter((i) => i.state === 'MISSING').length;
  const blocked = items.filter((i) => i.state === 'BLOCKED').length;
  const first = items.find((i) => i.state === 'BLOCKED') ?? items.find((i) => i.state === 'MISSING');
  return {
    action,
    label: EXTERNAL_ACTION_LABEL[action],
    items,
    candidates,
    candidateLabel: `${candidateLabel}（承認待ち${pending}件／承認済み${approved}件）`,
    missing,
    blocked,
    summary: first ? `${first.label}：${first.detail}` : 'そろっている',
  };
}

export type ReadinessSummary = {
  actions: ReadyAction[];
  totalMissing: number;
  totalBlocked: number;
  /** 全体で見て、いま最初にやるべきこと */
  nextStep: string;
  /** データ取得側で足りていない鍵 */
  dataKeys: { label: string; ok: boolean; how: string }[];
};

export async function readinessSummary(): Promise<ReadinessSummary> {
  const actions = await firstRunReadiness();
  const totalMissing = actions.reduce((a, x) => a + x.missing, 0);
  const totalBlocked = actions.reduce((a, x) => a + x.blocked, 0);

  const dataKeys = [
    { label: 'gBizINFO（国が公開している法人情報）', ok: hasSecret('GBIZINFO_API_TOKEN'), how: '無料の利用申請をして token を .env の GBIZINFO_API_TOKEN に入れる。' },
    { label: '国税庁 法人番号Web-API', ok: hasSecret('HOUJIN_BANGOU_APP_ID'), how: '無料のアプリケーションIDを申請し .env の HOUJIN_BANGOU_APP_ID に入れる。' },
    { label: 'Google Places（電話・HPの補完）', ok: hasSecret('GOOGLE_PLACES_API_KEY'), how: '有料。使うなら .env の GOOGLE_PLACES_API_KEY に入れる。無くても他の2つで動く。' },
    { label: '文章を書くAIの鍵', ok: hasSecret('OPENAI_API_KEY') || hasSecret('ANTHROPIC_API_KEY'), how: '.env の OPENAI_API_KEY を入れる。無い場合は決められた型の文章だけで動く。' },
  ];

  const noData = dataKeys.filter((k) => !k.ok && !k.label.startsWith('Google')).length > 0;
  const nextStep = noData
    ? '本物の会社データがまだ1件も取れない。まず gBizINFO と 法人番号Web-API の鍵（どちらも無料）を .env に入れる。ここが入るまで、その先の準備をしても試せない。'
    : config.aiEnabled
      ? '会社データは取れる。次は「どの操作を1件目にするか」を1つだけ決める。問い合わせフォームを選ぶ場合は、そのフォーム自身が営業目的の送信を受け付けているかを先に読む。「営業お断り」と書いてあるフォームは非常に多く、同意が要らないから安全という考え方は取らない。'
      : '会社データは取れる。文章を書くAIを使うなら .env の AI_ENABLED を true にする。';

  return { actions, totalMissing, totalBlocked, nextStep, dataKeys };
}
