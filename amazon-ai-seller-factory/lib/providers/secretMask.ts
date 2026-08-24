/**
 * 秘密情報のマスキング（SECRET MASK）
 * ===================================================================
 * ユーザー指示（2026-08-20）：
 *   「App Secret / Access Token を ログ・画面・Obsidian・DB へ平文保存しないでください。
 *     .env または Secret Manager のみ。ログでは ****1234 のようにマスク。」
 *
 * ★この方針の考え方
 *   鍵は「あるか無いか」と「どれか（末尾4桁）」さえ分かれば運用できる。
 *   全部を見せる必要は一度も無い。だから全部は絶対に出さない。
 *
 * ★ここに置く理由
 *   マスク処理があちこちにバラバラに書いてあると、必ず1か所書き忘れて漏れる。
 *   出口を1つにまとめて、どこから出すときも同じ関数を通す。
 */

/** 伏せる対象のキー名。増えたらここだけ足す */
const SECRET_KEYS = [
  'app_secret',
  'appsecret',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'sign',
  'signature',
  'app_key',
  'appkey',
  'client_secret',
  'api_key',
  'apikey',
  'authorization',
  'password',
];

/**
 * 鍵そのものを「****1234」の形にする。
 *
 * ★短い文字列（8文字未満）は末尾4桁すら出さない。
 *   短い鍵は末尾4桁だけで当てられてしまう可能性があるため。
 */
export function mask(raw: unknown): string {
  const s = raw === null || raw === undefined ? '' : String(raw);
  if (!s) return '（未設定）';
  if (s.length < 8) return '****';
  return `****${s.slice(-4)}`;
}

/**
 * 鍵があるかどうかだけを日本語で言う（末尾4桁つき）。
 * 画面・ログ・レポートに出してよいのはこの形だけ。
 */
export function describeSecret(label: string, raw: unknown): string {
  const s = raw === null || raw === undefined ? '' : String(raw);
  return s ? `${label}：設定済み（${mask(s)}）` : `${label}：未設定`;
}

/**
 * 文章・JSON文字列の中から鍵らしきものを伏せる。
 *
 * ★"key": "value" 形式と key=value 形式（URLのクエリ）の両方を潰す。
 *   APIのURLをそのままログに書いてしまう事故が一番多いので、URL形式を必ず含める。
 */
export function redactSecrets(raw: string): string {
  if (!raw) return raw;
  const keys = SECRET_KEYS.join('|');
  return (
    raw
      // "app_secret": "xxxx"  /  app_secret = xxxx
      .replace(new RegExp(`("?(${keys})"?\\s*[:=]\\s*"?)([^",&}\\s]+)`, 'gi'), (_m, head, _k, val) =>
        `${head}${mask(val)}`,
      )
      // Bearer xxxxx
      .replace(/(Bearer\s+)([A-Za-z0-9._-]{8,})/gi, (_m, head, val) => `${head}${mask(val)}`)
  );
}

/**
 * ★保存前の最終確認。
 *   「.env に入っている実際の鍵の文字列」がそのまま含まれていないかを見る。
 *   含まれていたら伏せる。マスク漏れの最後の網。
 *
 *   secrets には .env から読んだ生の値を渡す（この関数の外へは出さない）。
 */
export function scrubKnownSecrets(text: string, secrets: (string | undefined | null)[]): string {
  let out = redactSecrets(text ?? '');
  for (const s of secrets) {
    if (!s || String(s).length < 8) continue;
    out = out.split(String(s)).join(mask(s));
  }
  return out;
}

/**
 * 保存してよい文字列かを判定する（保存直前のガード）。
 * 生の鍵が残っていたら true を返す＝保存を止める材料にする。
 */
export function containsRawSecret(text: string, secrets: (string | undefined | null)[]): boolean {
  for (const s of secrets) {
    if (!s || String(s).length < 8) continue;
    if ((text ?? '').includes(String(s))) return true;
  }
  return false;
}
