import { all, nowIso, run } from './db/client';

/**
 * 判断に使う数字はここに集める。コードの中に数字を散らさない。
 *
 * ★is_estimated（未実測）の印を必ず持たせる。
 *   実測していない数字で出した期待値を「実測の期待値」として扱わないため。
 *   実際に営業を始めたら、ここを実測値に置き換える。
 */

export type SettingDef = {
  key: string;
  value: string;
  valueType: 'int' | 'float' | 'string';
  label: string;
  group: string;
  hint: string;
};

export const DEFAULT_SETTINGS: SettingDef[] = [
  // ---- 営業1件あたりのコスト（円）。全部まだ未実測の仮置き。
  { key: 'cost.phone', value: '120', valueType: 'int', label: 'AI電話1件あたりのコスト（円）', group: 'cost', hint: '未実測の仮置き。通話料＋音声AIの想定。実際に回したら実測値へ置き換える。' },
  { key: 'cost.email', value: '15', valueType: 'int', label: 'メール1通あたりのコスト（円）', group: 'cost', hint: '未実測の仮置き。文面生成のAI費用＋送信費の想定。' },
  { key: 'cost.form', value: '40', valueType: 'int', label: 'フォーム1件あたりのコスト（円）', group: 'cost', hint: '未実測の仮置き。フォーム解析＋文面生成の想定。' },
  { key: 'cost.manual', value: '1500', valueType: 'int', label: '手作業1件あたりのコスト（円）', group: 'cost', hint: '未実測の仮置き。人が調べて連絡する場合の時間コスト。' },

  // ---- 成約率の初期値。実績が溜まるまではこれを使う。
  { key: 'baserate.close', value: '0.01', valueType: 'float', label: '成約率の初期値', group: 'rate', hint: '未実測の仮置き。実績が20件を超えた業種・商品から、実測値へ自動で切り替える。' },
  { key: 'learning.min_samples', value: '20', valueType: 'int', label: '学習を使い始める最低件数', group: 'rate', hint: 'これ未満の実績では、AIの推測でスコアを動かさない。' },

  // ---- 案件側
  { key: 'job.target_hourly', value: '5000', valueType: 'int', label: '目標時給（円）', group: 'job', hint: 'これを下回る案件は優先しない。' },
  { key: 'job.min_hourly', value: '2000', valueType: 'int', label: '最低時給（円）', group: 'job', hint: 'これを下回る案件は応募しない。' },
  { key: 'job.ai_cost_per_hour', value: '300', valueType: 'int', label: '作業1時間あたりのAI費用（円）', group: 'job', hint: '未実測の仮置き。' },
  { key: 'job.base_win_rate', value: '0.15', valueType: 'float', label: '受注率の初期値', group: 'job', hint: '未実測の仮置き。実績が溜まったら実測値へ。' },

  // ---- 品質のしきい値
  { key: 'draft.max_similarity', value: '0.6', valueType: 'float', label: '文面の使い回し上限', group: 'quality', hint: '他社宛ての文面とこれ以上似ていたら、その下書きは止める。' },
  { key: 'draft.min_personalization', value: '1', valueType: 'int', label: '個別化の最低点数', group: 'quality', hint: 'その会社を実際に読んで書いた要素が、最低いくつ入っている必要があるか。' },
];

let cache: Map<string, string> | null = null;

export async function initSettings(): Promise<void> {
  const at = nowIso();
  for (const s of DEFAULT_SETTINGS) {
    // 値は上書きしない（人が直した数字を毎回初期値へ戻さないため）。
    // 説明文だけは最新にする。
    await run(
      `INSERT INTO settings (key, value, value_type, label, group_key, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_type = excluded.value_type, label = excluded.label, group_key = excluded.group_key, hint = excluded.hint, updated_at = excluded.updated_at`,
      [s.key, s.value, s.valueType, s.label, s.group, s.hint, at],
    );
  }
  cache = null;
}

export async function loadSettings(): Promise<Map<string, string>> {
  if (cache) return cache;
  const rows = await all('SELECT key, value FROM settings');
  const m = new Map<string, string>();
  for (const r of rows) m.set(String(r.key), String(r.value));
  for (const d of DEFAULT_SETTINGS) if (!m.has(d.key)) m.set(d.key, d.value);
  cache = m;
  return m;
}

export function clearSettingsCache(): void {
  cache = null;
}

export async function num(key: string): Promise<number> {
  const m = await loadSettings();
  const v = Number(m.get(key));
  if (Number.isFinite(v)) return v;
  const d = DEFAULT_SETTINGS.find((s) => s.key === key);
  return d ? Number(d.value) : 0;
}
