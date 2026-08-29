import { insert, nowIso, run, type Row } from '../db/client';

/**
 * 案件の足切り。
 *
 * ★固定ルール。ここはAIの判断で緩めない。
 *   時間を拘束される仕事は、いくら単価が良くても取らない。
 *   （AIで自動化できず、他の全ての仕事が止まるため）
 *   違法・規約違反・なりすましは、金額に関係なく即除外。
 */

/**
 * ★HARD_BLOCK は固定。AIの判断でも、点数が高くても、絶対に外れない。
 *   ここを「条件付きで通す」に変えてはいけない。時間を拘束される仕事を1件でも受けると、
 *   AIで自動化している他の全ての案件が同時に止まるため。
 */
export type ExclusionSeverity = 'HARD_BLOCK';

export type ExclusionRule = {
  code: string;
  label: string;
  why: string;
  /** 固定の足切り。全ルールが HARD_BLOCK。緩和したい場合は人がコードを変えるしかない。 */
  severity: ExclusionSeverity;
  patterns: RegExp[];
  /** この語があれば、そのルールは当てはまらない（誤爆よけ） */
  unless?: RegExp[];
  /**
   * 語句だけでは決められないもの（数字のしきい値など）を見る。
   * 当てはまったら、根拠になった文字列を返す。当てはまらなければ null。
   */
  detect?: (text: string) => string | null;
};

/** 週にこれ以上の時間を先に取られる案件は受けない。 */
export const WEEKLY_HOURS_BLOCK = 20;

const NUM = '[0-9０-９]+';
function toHalf(s: string): number {
  return Number(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

/** 「週30時間以上」のような書き方から、拘束される時間を読み取る。 */
function weeklyHours(text: string): string | null {
  const weekly = new RegExp(`週\\s*(?:あたり|当たり)?\\s*(${NUM})\\s*時間`, 'g');
  for (const m of text.matchAll(weekly)) {
    if (toHalf(m[1]) >= WEEKLY_HOURS_BLOCK) return m[0];
  }
  // 月◯時間は4.3週で割って週あたりに直す
  const monthly = new RegExp(`月\\s*(?:あたり|当たり)?\\s*(${NUM})\\s*時間`, 'g');
  for (const m of text.matchAll(monthly)) {
    if (toHalf(m[1]) / 4.3 >= WEEKLY_HOURS_BLOCK) return m[0];
  }
  return null;
}

export const EXCLUSION_RULES: ExclusionRule[] = [
  {
    code: 'FULLTIME_HOURS',
    label: '1日8時間などの長時間拘束',
    why: '時間を売る仕事はAIで置き換えられず、他の案件が全部止まる',
    severity: 'HARD_BLOCK',
    patterns: [/1日\s*[89１２]\s*時間/, /[89]\s*時間\s*(勤務|稼働|拘束|以上)/, /実働\s*[89]/, /フルタイム/, /8h\s*\/\s*日/i],
  },
  {
    code: 'WEEKLY_FIXED',
    label: '週5日などの固定シフト',
    why: '曜日が固定されると他の仕事を入れられない',
    severity: 'HARD_BLOCK',
    patterns: [/週\s*[45５４]\s*日\s*(以上|固定|勤務)/, /シフト\s*制/, /月〜金/, /月曜.{0,3}金曜/],
  },
  {
    code: 'EMPLOYMENT',
    label: '正社員・アルバイト等の雇用',
    why: '業務委託ではないので受けられない',
    severity: 'HARD_BLOCK',
    patterns: [/正社員/, /契約社員/, /アルバイト/, /パート募集/, /雇用契約/, /社会保険/, /試用期間/],
  },
  {
    code: 'ONSITE',
    label: '常駐・出社が必要',
    why: '場所を拘束されるとAIで自動化できない',
    severity: 'HARD_BLOCK',
    patterns: [/常駐/, /出社/, /来社/, /対面(必須|での)/, /現地(作業|対応|訪問)/, /オフィス勤務/, /通勤/],
  },
  {
    code: 'HOURLY_LABOR',
    label: '時給での労働が中心',
    why: '成果ではなく時間で払われる仕事は、AIを使うほど自分の取り分が減る',
    severity: 'HARD_BLOCK',
    patterns: [/時給\s*[0-9０-９]/, /時間単価/, /稼働時間\s*に応じて/],
    unless: [/成果報酬/, /固定報酬/],
  },
  {
    code: 'ALWAYS_ON',
    label: '常時対応・即レス要求',
    why: '待機そのものが拘束になる',
    severity: 'HARD_BLOCK',
    patterns: [/即レス/, /常時対応/, /24時間対応/, /チャットに\s*すぐ/, /連絡が取れる方/],
  },
  {
    code: 'WEEKLY_HOURS',
    label: `週${WEEKLY_HOURS_BLOCK}時間以上の拘束`,
    why: '週の時間を先に押さえられると、AIで短縮しても自分の取り分が増えず、他の案件を入れる余地も消える',
    severity: 'HARD_BLOCK',
    patterns: [],
    // 「成果物いくら」の仕事に目安として書かれた時間まで拾わない
    unless: [/固定報酬/, /成果報酬/, /(納品|成果物)\s*(単位|ごと)/],
    detect: weeklyHours,
  },
  {
    code: 'DAILY_MEETING',
    label: '毎日の定例参加が必須',
    why: '毎日決まった時刻に呼ばれると、その時間は他の案件に使えない',
    severity: 'HARD_BLOCK',
    patterns: [
      /(毎日|日次|デイリー)\s*(の)?\s*(定例|朝会|夕会|MTG|ミーティング|打ち合わせ|進捗会|スタンドアップ)/i,
      /(朝会|夕会|デイリースクラム)\s*(への)?\s*(参加|出席)\s*(が)?\s*(必須|必要)/,
      /(定例|ミーティング|MTG)\s*(に)?\s*(毎日|日次で)\s*(参加|出席)/i,
    ],
  },
  {
    code: 'DAYTIME_CONTACT',
    label: '日中の常時連絡が必須',
    why: '日中いつでも応じる約束は、待機時間ごと売っているのと同じ',
    severity: 'HARD_BLOCK',
    patterns: [
      /(平日|日中|営業時間内)[^。\n]{0,8}(常時|随時|いつでも)[^。\n]{0,4}(連絡|対応|返信)/,
      /(平日|日中)\s*[0-9０-９]{1,2}\s*時\s*[〜~ー-]\s*[0-9０-９]{1,2}\s*時\s*(の間\s*)?(は)?\s*(連絡|対応|待機)\s*(が)?\s*(可能|必須|取れる)/,
      /(日中|平日)\s*(に)?\s*(すぐ|即)\s*(返信|返答|対応)\s*(できる|いただける)/,
      /リアルタイム\s*(で)?\s*(の)?\s*(連絡|やりとり|対応)\s*(が)?\s*(必須|必要)/,
    ],
  },
  {
    code: 'TIME_TRACKING',
    label: '作業時間を計測・監視される',
    why: '時間を測られる契約は成果ではなく時間を売る契約。AIで速く終わらせるほど損をする',
    severity: 'HARD_BLOCK',
    patterns: [
      /(作業時間|稼働時間|勤務時間)\s*(を)?\s*(の)?\s*(計測|記録|報告|申告|管理)\s*(が)?\s*(必須|必要|していただ|お願い)/,
      /(タイムカード|勤怠(管理|入力|打刻)|打刻)/,
      /(時間管理|勤怠|稼働管理)\s*ツール\s*(の)?\s*(導入|インストール|利用)\s*(が)?\s*(必須|必要)/,
      /(Time\s*Doctor|Hubstaff|Toggl)\s*(の)?\s*(導入|利用|使用)/i,
    ],
    // 「勤怠管理システムを作ってください」という開発依頼を、監視される案件と取り違えない
    unless: [/(勤怠|時間管理|稼働管理).{0,12}(システム|ツール|アプリ|画面).{0,20}(開発|制作|作成|構築|実装)/],
  },
  {
    code: 'PC_MONITORING',
    label: 'PC画面を監視される',
    why: '画面を撮られる働き方はAIでの自動化と両立しない（自動化そのものが問題視される）',
    severity: 'HARD_BLOCK',
    patterns: [
      /(スクリーンショット|スクショ|画面|デスクトップ)\s*(を)?\s*(定期(的)?に|自動(的)?に|ランダムに)?\s*(撮影|取得|記録|監視|キャプチャ)/,
      /(PC|パソコン|端末)\s*(の)?\s*(操作|画面|作業)\s*(を)?\s*(監視|記録|モニタリング)/,
      /(監視|モニタリング)\s*ツール\s*(の)?\s*(導入|インストール)\s*(が)?\s*(必須|必要)/,
      /(ウェブカメラ|Webカメラ|カメラ)\s*(を)?\s*(常時)?\s*(オン|ON|起動)\s*(が)?\s*(必須|必要)/i,
    ],
    // 「監視ツールを開発してください」という依頼を、監視される案件と取り違えない
    unless: [/(監視|モニタリング|キャプチャ).{0,12}(システム|ツール|アプリ|機能).{0,20}(開発|制作|作成|構築|実装)/],
  },
  {
    code: 'ILLEGAL',
    label: '違法・犯罪に関わる',
    why: '受けてはいけない',
    severity: 'HARD_BLOCK',
    patterns: [/名義貸し/, /口座(の)?(貸|譲渡|売買)/, /受け子/, /出し子/, /裏バイト/, /闇バイト/, /高額報酬.{0,10}即日現金/, /無在庫転売の代行/, /著作権(を)?無視/],
  },
  {
    code: 'IMPERSONATION',
    label: '本人確認の偽装・なりすまし',
    why: 'アカウント停止と法的責任に直結する',
    severity: 'HARD_BLOCK',
    patterns: [/本人確認.{0,8}(代行|なりすまし|偽装|回避)/, /他人名義/, /身分証.{0,6}(貸|借|用意)/, /複数アカウント/, /サブ垢/],
  },
  {
    code: 'THIRD_PARTY_ACCOUNT',
    label: '第三者アカウントの操作',
    why: '各サービスの規約違反になる',
    severity: 'HARD_BLOCK',
    patterns: [/(アカウント|ID).{0,6}(お貸し|貸与|共有|預か)/, /ログイン情報.{0,6}(共有|お渡し)/, /代理ログイン/],
  },
  {
    code: 'TOS_VIOLATION',
    label: '規約違反を求めている',
    why: '依頼どおりに作ると規約違反になる',
    severity: 'HARD_BLOCK',
    patterns: [/スクレイピング/, /クロール(して|で).{0,10}(収集|取得)/, /自動収集/, /bot(で|を使って)/i, /CAPTCHA.{0,6}(突破|回避)/i, /規約.{0,4}(グレー|ギリギリ)/],
  },
  {
    code: 'FAKE_REVIEW',
    label: 'サクラ・やらせ',
    why: '景表法（ステマ規制）違反になる',
    severity: 'HARD_BLOCK',
    patterns: [/サクラ/, /やらせ/, /(高評価|口コミ|レビュー).{0,8}(投稿|書いて|依頼)/, /自演/],
  },
  {
    code: 'NO_AI',
    label: 'AI利用が禁止されている',
    why: 'AIを使えない仕事は、自分がやる意味がない（時間だけ消える）',
    severity: 'HARD_BLOCK',
    patterns: [/AI.{0,6}(禁止|不可|使用しないで|使わないで)/, /ChatGPT.{0,6}(禁止|不可)/i, /生成AI.{0,6}(禁止|不可)/, /手作業(のみ|で)/],
  },
  {
    code: 'ADULT',
    label: 'アダルト・出会い系',
    why: '入金手段と法令の面で扱えない',
    severity: 'HARD_BLOCK',
    patterns: [/アダルト/, /出会い系/, /R-?18/i, /風俗/],
  },
];

export type ExclusionHit = { code: string; label: string; why: string; matched: string };

/** 案件の文面から、受けてはいけない理由を全部拾う。 */
export function findExclusions(text: string): ExclusionHit[] {
  const hits: ExclusionHit[] = [];
  for (const rule of EXCLUSION_RULES) {
    if (rule.unless?.some((u) => u.test(text))) continue;
    // 語句で拾う
    const m = rule.patterns.map((p) => text.match(p)).find((x) => x !== null);
    if (m) {
      hits.push({ code: rule.code, label: rule.label, why: rule.why, matched: m[0] });
      continue;
    }
    // 数字のしきい値などで拾う
    const d = rule.detect?.(text) ?? null;
    if (d) hits.push({ code: rule.code, label: rule.label, why: rule.why, matched: d });
  }
  return hits;
}

/** 案件1件を判定して、除外理由をDBに残す。 */
export async function evaluateExclusions(job: Row): Promise<ExclusionHit[]> {
  const jobId = Number(job.id);
  const text = [job.title, job.description, job.work_style, job.category].filter(Boolean).map(String).join('\n');
  const hits = findExclusions(text);

  await run('DELETE FROM job_exclusions WHERE job_id = ?', [jobId]);
  for (const h of hits) {
    await insert('job_exclusions', { job_id: jobId, rule_code: h.code, matched_text: h.matched, created_at: nowIso() });
  }
  return hits;
}
