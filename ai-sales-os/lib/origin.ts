/**
 * 「そのデータは本物か、練習用か」を1か所で決める。
 *
 * ★このシステムで一番やってはいけないのは、
 *   練習用に作った会社・案件の数を「本物の営業候補◯件」として報告すること。
 *   数字が良く見えるだけで、実際には1件も送れない。
 *   だから会社と案件のすべてに「どこから来たデータか」を必ず持たせ、
 *   集計・画面・バックテスト・実行の手前で必ず分ける。
 *
 * ★TEST は、たとえ人が承認しても外部への実行へ進めない。
 *   これは設定ではなく、コードの分岐で止める。
 */

export const DATA_ORIGINS = [
  'TEST',
  // ── 会社（法人営業）側
  'REAL_OFFICIAL',
  'REAL_USER_OWNED',
  'REAL_API',
  // ── 会社・案件の両方で使う
  'REAL_MANUAL',
  // ── 案件（受注）側。★どの入口から入った案件かを、集計しても消えない形で残す。
  //    「REAL案件20件」と報告するとき、その20件がメール通知なのか手入力なのかで
  //    信じてよい範囲がまるで違う。1つの REAL にまとめると、そこが言えなくなる。
  'REAL_EMAIL_ALERT',
  'REAL_CSV',
  'REAL_REFERRAL',
  'REAL_OFFICIAL_API',
] as const;

export type DataOrigin = (typeof DATA_ORIGINS)[number];

export const ORIGIN_JA: Record<DataOrigin, string> = {
  TEST: '練習用（送信不可）',
  REAL_OFFICIAL: '本物・国の公開データ',
  REAL_MANUAL: '本物・人が手で入れた',
  REAL_USER_OWNED: '本物・自分が持っているデータ',
  REAL_API: '本物・提供元のAPI',
  REAL_EMAIL_ALERT: '本物・求人サイトから届いた通知メール',
  REAL_CSV: '本物・人がCSVで取り込んだ',
  REAL_REFERRAL: '本物・知り合い／過去の取引先からの紹介',
  REAL_OFFICIAL_API: '本物・提供元の公式API',
};

export const ORIGIN_SHORT_JA: Record<DataOrigin, string> = {
  TEST: 'TEST',
  REAL_OFFICIAL: 'REAL(公的)',
  REAL_MANUAL: 'REAL(手入力)',
  REAL_USER_OWNED: 'REAL(自社)',
  REAL_API: 'REAL(API)',
  REAL_EMAIL_ALERT: 'REAL(メール通知)',
  REAL_CSV: 'REAL(CSV)',
  REAL_REFERRAL: 'REAL(紹介)',
  REAL_OFFICIAL_API: 'REAL(公式API)',
};

/**
 * 案件で使ってよい出どころ。
 * ★案件側はこの5つ以外を本物として扱わない。
 *   会社側の REAL_OFFICIAL などが案件に紛れ込むと、入口別の件数が合わなくなる。
 */
export const JOB_DATA_ORIGINS = ['REAL_EMAIL_ALERT', 'REAL_MANUAL', 'REAL_CSV', 'REAL_REFERRAL', 'REAL_OFFICIAL_API'] as const;
export type JobDataOrigin = (typeof JOB_DATA_ORIGINS)[number];

export function isJobOrigin(v: unknown): v is JobDataOrigin {
  return (JOB_DATA_ORIGINS as readonly string[]).includes(String(v ?? ''));
}

/** 知らない値が来たら本物と見なさない。分からないものを本番に混ぜない。 */
export function toOrigin(v: unknown): DataOrigin {
  const s = String(v ?? '').trim().toUpperCase();
  return (DATA_ORIGINS as readonly string[]).includes(s) ? (s as DataOrigin) : 'TEST';
}

/** 本物かどうか。ここを通らないものは本番KPIに入れない。 */
export function isReal(v: unknown): boolean {
  return toOrigin(v) !== 'TEST';
}

/**
 * 取得元（source）から、そのデータの出どころを決める。
 * ★推測で REAL にしない。国の公開データ・自分のデータ・人の手入力だけを本物として扱う。
 */
export function originForCompanySource(source: string): DataOrigin {
  switch (source) {
    case 'HOUJIN_BANGOU':
      // 国税庁 法人番号公表サイトの公開データ
      return 'REAL_OFFICIAL';
    case 'GBIZINFO':
      return 'REAL_OFFICIAL';
    case 'GOOGLE_PLACES':
      return 'REAL_API';
    case 'OFFICIAL_SITE':
      return 'REAL_OFFICIAL';
    case 'EXISTING_LIST':
      return 'REAL_USER_OWNED';
    case 'CSV':
      return 'REAL_MANUAL';
    case 'MANUAL':
      return 'REAL_MANUAL';
    default:
      return 'TEST';
  }
}

/**
 * 案件の入口から、その案件の出どころを決める。
 *
 * ★入口ごとに別の値にする。まとめない。
 *   「REAL案件20件」と言うとき、それがサイトから届いた通知なのか、
 *   人が本文を貼ったものなのか、紹介なのかで、信じてよい範囲がまるで違う。
 *   1つの REAL にまとめると、あとから内訳を出せなくなる。
 * ★知らない入口は TEST のまま。推測で本物に格上げしない。
 */
export function originForJobSource(source: string): DataOrigin {
  switch (source) {
    case 'OFFICIAL_API':
    case 'API':
      return 'REAL_OFFICIAL_API';
    case 'EMAIL_ALERT':
      return 'REAL_EMAIL_ALERT';
    case 'MANUAL_URL':
    case 'MANUAL_TEXT':
    case 'MANUAL':
      return 'REAL_MANUAL';
    case 'CSV_IMPORT':
    case 'CSV':
      return 'REAL_CSV';
    case 'REFERRAL':
      return 'REAL_REFERRAL';
    default:
      return 'TEST';
  }
}

/** SQLの断片。集計を書くたびに書き間違えないように、ここに固める。 */
export const REAL_SQL = "data_origin <> 'TEST'";
export const TEST_SQL = "data_origin = 'TEST'";

/**
 * 外部への実行に進めてよいか。
 * ★練習用データは、人が承認ボタンを押しても絶対に進めない。
 */
export function canReachExecutor(origin: unknown): { ok: boolean; reason: string } {
  if (!isReal(origin)) {
    return { ok: false, reason: '練習用のデータなので、外部への操作には進めない。' };
  }
  return { ok: true, reason: '' };
}
