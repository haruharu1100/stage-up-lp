import { REAL_SQL, TEST_SQL } from '../lib/origin';

/**
 * どの範囲の会社・案件を対象にするかを、コマンドの引数から1か所で決める。
 *
 * ★ここを各スクリプトで書き分けると、必ずどこかで本物と練習用が混ざる。
 *   混ざった数字は「営業できる会社◯件」という嘘になるので、判定はこの1か所に置く。
 *
 * 使い方: npm run analyze -- --real   （本物だけ）
 *         npm run analyze -- --test   （練習用だけ）
 *         引数なし = 全部（画面の動作確認用。報告には使わない）
 */

export type Scope = 'REAL' | 'TEST' | 'ALL';

export function scopeFromArgv(argv: string[] = process.argv): Scope {
  if (argv.includes('--real')) return 'REAL';
  if (argv.includes('--test')) return 'TEST';
  const i = argv.indexOf('--scope');
  if (i >= 0) {
    const v = String(argv[i + 1] ?? '').toUpperCase();
    if (v === 'REAL' || v === 'TEST' || v === 'ALL') return v;
  }
  return 'ALL';
}

/**
 * WHERE 句に足す条件。ALL のときは常に真になる条件を返す（分岐を書かなくて済むように）。
 * 表に別名を付けている問い合わせでは alias を渡す（例: scopeSql('REAL', 'c') → "c.data_origin <> 'TEST'"）。
 */
export function scopeSql(scope: Scope, alias?: string): string {
  const col = alias ? `${alias}.data_origin` : 'data_origin';
  if (scope === 'REAL') return REAL_SQL.replace('data_origin', col);
  if (scope === 'TEST') return TEST_SQL.replace('data_origin', col);
  return '1 = 1';
}

export const SCOPE_JA: Record<Scope, string> = {
  REAL: '本物のデータ（REAL）だけ',
  TEST: '練習用のデータ（TEST）だけ',
  ALL: '全部（本物と練習用の両方。この数字は報告に使わない）',
};
