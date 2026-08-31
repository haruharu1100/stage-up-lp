import { all, nowIso, run } from './db/client';
import { OFFERS } from './catalog/definitions';

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

  // ---- 外部への実行を止める2つのつまみ（PHASE C）
  //
  // ★どちらも既定は「止まっている側」にしてある。
  //   人が意図して解除しないかぎり、外へは何も出ない。
  //   なお今は解除しても何も起きない（実行する処理コードが存在しないため）。
  { key: 'exec.kill_switch', value: 'OFF', valueType: 'string', label: '全停止スイッチ', group: 'exec', hint: 'OFF＝外への操作を一切通さない（既定）。解除するときだけ ARMED に変える。1文字でも違えば止まったまま。' },
  { key: 'exec.daily_limit', value: '', valueType: 'string', label: '1日に実行してよい上限（全体・件）', group: 'exec', hint: '空欄＝未設定。未設定は「無制限」ではなく「上限を超えていないと言えない」として扱い、実行を止めます。' },

  // ---- 手段ごとの上限（PHASE 3）
  //
  // ★なぜ全体の上限と別に持つか。
  //   電話は相手の時間を奪う。メールは相手の受信箱に残る。フォームは相手の窓口を埋める。
  //   1件あたりの重さが違うのに1つの数字でまとめると、
  //   「今日はメールを50件出したので電話の枠が無い」という意味のない止まり方をする。
  // ★どれも空欄で置く。初期値を勝手に大きくしない。
  //   最初の1日で100件出して全部が的外れだった、という失敗は取り返せない。
  { key: 'exec.daily_limit.call', value: '', valueType: 'string', label: '1日に実行してよい上限（電話・件）', group: 'exec', hint: '空欄＝未設定。未設定のあいだ、電話の実行は止まります（無制限にはなりません）。' },
  { key: 'exec.daily_limit.email', value: '', valueType: 'string', label: '1日に実行してよい上限（メール・件）', group: 'exec', hint: '空欄＝未設定。未設定のあいだ、メールの実行は止まります（無制限にはなりません）。' },
  { key: 'exec.daily_limit.form', value: '', valueType: 'string', label: '1日に実行してよい上限（フォーム・件）', group: 'exec', hint: '空欄＝未設定。未設定のあいだ、フォームの実行は止まります（無制限にはなりません）。' },
  {
    key: 'exec.cooldown_days',
    value: '',
    valueType: 'string',
    label: '同じ会社へ次に営業してよくなるまでの日数',
    group: 'exec',
    hint: '空欄＝もとからの90日を使います。90日より短い数を入れても短くはなりません（長くする方向にだけ効きます）。',
  },
];

/**
 * 値段が決まっていない商品の「いくらで売るか」を、人が1か所で決めるための欄。
 *
 * ★なぜ空で置くか。
 *   値段が決まっていない商品は、予想売上も予想利益も出せない。
 *   ここで「たぶん20万円くらい」と仮の数字を入れると、
 *   その仮の数字で会社の並び順が変わり、間違った会社に営業しに行くことになる。
 *   だから既定値は空（＝未設定）にして、空のままなら金額を計算せず
 *   「値段が未設定なので出せない」と書く。数字をでっち上げない。
 *
 * ★埋めるのは人。AIがここへ勝手に数字を入れない。
 */
export const PRICE_SETTING_GROUP = 'price';

export function priceSettingKeys(offerCode: string): { min: string; max: string; margin: string } {
  return {
    min: `price.${offerCode}.min`,
    max: `price.${offerCode}.max`,
    margin: `price.${offerCode}.margin`,
  };
}

/**
 * 原価と想定作業時間の欄。
 *
 * ★なぜ「手元に残る割合」と別に持つか。
 *   割合（例0.7）はあとから決めた勘の数字になりやすい。
 *   1件いくらかかるか（原価）と、何時間かかるか、を実額で持てるなら
 *   そちらの方が確か。両方空なら利益は出さない（0円として扱わない）。
 */
export function costSettingKeys(offerCode: string): { direct: string; hours: string } {
  return {
    direct: `cost.offer.${offerCode}.direct`,
    hours: `hours.offer.${offerCode}`,
  };
}

/**
 * 商品ごとの「金額・原価・想定作業時間」の欄を作る。
 *
 * ★カタログに金額が入っている商品でも欄は作る。
 *   以前はカタログに金額があるとこの欄を作らなかったので、
 *   「その金額を人が直したい」と思っても直す場所がどこにも無かった。
 *   空欄のあいだはカタログの金額が使われ、入れた瞬間そちらが優先される。
 */
function priceSettingDefs(): SettingDef[] {
  const defs: SettingDef[] = [];
  for (const o of OFFERS) {
    const k = priceSettingKeys(o.code);
    const ck = costSettingKeys(o.code);
    const model = o.priceModel === 'monthly' ? '月額' : o.priceModel === 'onetime' ? '一括' : '（課金の形も未定）';
    const catalogNote =
      o.priceMin !== null || o.priceMax !== null
        ? `空欄のあいだはカタログの金額（${o.priceMin ?? '—'}〜${o.priceMax ?? '—'}円／${o.priceStatus === 'CONFIRMED' ? '確定' : '仮'}）を使います。ここに入れるとそちらが優先されます。`
        : '空欄＝未設定。空のままだと、この商品の予想売上・予想利益は「計算できない」と表示されます。';
    defs.push(
      { key: k.min, value: '', valueType: 'string', label: `${o.name}：下限の金額（円・${model}）`, group: PRICE_SETTING_GROUP, hint: catalogNote },
      { key: k.max, value: '', valueType: 'string', label: `${o.name}：上限の金額（円・${model}）`, group: PRICE_SETTING_GROUP, hint: '空欄＝未設定。下限だけでも入れれば計算できます。' },
      { key: k.margin, value: '', valueType: 'string', label: `${o.name}：手元に残る割合（0〜1）`, group: PRICE_SETTING_GROUP, hint: '空欄＝未設定。例：0.7 なら売上の7割が利益。空のままだと予想利益は出しません。' },
      { key: ck.direct, value: '', valueType: 'string', label: `${o.name}：1件あたりの原価（円）`, group: PRICE_SETTING_GROUP, hint: '空欄＝未設定。入れると「金額−原価」で想定粗利を出します。空のまま0円として扱うことはしません。' },
      { key: ck.hours, value: '', valueType: 'string', label: `${o.name}：想定作業時間（時間）`, group: PRICE_SETTING_GROUP, hint: '空欄＝未設定。入れると時給換算を出します。空のままだと時給は出しません。' },
    );
  }
  return defs;
}

/** 初期化・画面で使う全設定。値段の欄は商品カタログから自動で並ぶ。 */
export function allSettingDefs(): SettingDef[] {
  return [...DEFAULT_SETTINGS, ...priceSettingDefs()];
}

/** 件数・日数として読む欄。文字列型で持っているが、中身は数字でなければならない。 */
const NUMERIC_EXEC_KEYS = new Set([
  'exec.daily_limit',
  'exec.daily_limit.call',
  'exec.daily_limit.email',
  'exec.daily_limit.form',
  'exec.cooldown_days',
]);

let cache: Map<string, string> | null = null;

export async function initSettings(): Promise<void> {
  const at = nowIso();
  for (const s of allSettingDefs()) {
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
  for (const d of allSettingDefs()) if (!m.has(d.key)) m.set(d.key, d.value);
  cache = m;
  return m;
}

export function clearSettingsCache(): void {
  cache = null;
}

/**
 * 人が画面から入れた値を保存する。
 *
 * ★勝手に直さない。おかしい値は保存せず、理由を返す。
 *   例：「20万くらい」を数字として読めるところだけ拾って 20 にする、といったことはしない。
 *   拾ってしまうと、本人は20万円のつもりなのに20円で計算が回る。
 *
 * ★空文字は「未設定に戻す」。0とは別のこと。
 *   0で保存すると「0円の商品」として計算が通ってしまう。
 */
export async function setSetting(key: string, raw: string): Promise<{ ok: boolean; reasonJa: string }> {
  const def = allSettingDefs().find((d) => d.key === key);
  if (!def) return { ok: false, reasonJa: `知らない設定項目です（${key}）。画面に無い項目は保存しません。` };

  const v = String(raw ?? '').trim();
  if (v !== '') {
    if (def.valueType === 'int' || def.valueType === 'float') {
      const n = Number(v);
      if (!Number.isFinite(n)) return { ok: false, reasonJa: `「${def.label}」は数字で入れてください（入力された値：${v}）。` };
      if (n < 0) return { ok: false, reasonJa: `「${def.label}」に負の数は入れられません。` };
    } else if (def.group === PRICE_SETTING_GROUP) {
      // 値段・原価・作業時間の欄は文字列型で持っているが、中身は数字でなければならない。
      const n = Number(v);
      if (!Number.isFinite(n)) return { ok: false, reasonJa: `「${def.label}」は数字だけで入れてください（「20万」「約10」などは読めません）。入力された値：${v}` };
      if (n < 0) return { ok: false, reasonJa: `「${def.label}」に負の数は入れられません。` };
      if (key.endsWith('.margin') && (n < 0 || n > 1)) {
        return { ok: false, reasonJa: `「${def.label}」は0〜1で入れてください（例：0.7 なら売上の7割が利益）。入力された値：${v}` };
      }
    } else if (NUMERIC_EXEC_KEYS.has(key)) {
      // ★件数・日数の欄も数字だけを受け取る。
      //   「10件」と入れられたものを 10 として拾うことはしない。
      //   拾い方を1つ許すと、読めない文字列を勝手に解釈する道ができてしまう。
      const n = Number(v);
      if (!Number.isFinite(n)) return { ok: false, reasonJa: `「${def.label}」は数字だけで入れてください（「10件」「約20」などは読めません）。入力された値：${v}` };
      if (!Number.isInteger(n) || n <= 0) {
        return { ok: false, reasonJa: `「${def.label}」は1以上の整数で入れてください。空欄にすると未設定に戻ります（0は「0件まで」ではなく未設定として扱います）。入力された値：${v}` };
      }
    }
  }

  await run(`UPDATE settings SET value = ?, updated_at = ? WHERE key = ?`, [v, nowIso(), key]);
  cache = null;
  return { ok: true, reasonJa: '' };
}

export async function num(key: string): Promise<number> {
  const m = await loadSettings();
  const v = Number(m.get(key));
  if (Number.isFinite(v)) return v;
  const d = DEFAULT_SETTINGS.find((s) => s.key === key);
  return d ? Number(d.value) : 0;
}

/**
 * 「未設定」と「0」を区別して読む。
 * ★空欄を0として読むと、値段0円の商品として計算が通ってしまう。
 *   分からないものは null のまま返し、呼び出した側に「計算できない」と言わせる。
 */
export async function numOrNull(key: string): Promise<number | null> {
  const m = await loadSettings();
  const raw = String(m.get(key) ?? '').trim();
  if (raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}
