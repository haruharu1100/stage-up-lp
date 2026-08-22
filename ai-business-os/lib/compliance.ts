/**
 * 景表法・特商法まわりの自動チェック。
 * 生成した文章は必ずここを通す。断定・誇大・二重価格・煽りを出さない。
 * 法律判断が要る内容は「要専門家確認」を返す（AIが白黒つけない）。
 */
export type ComplianceIssue = {
  severity: 'BLOCK' | 'WARN' | 'EXPERT_REVIEW';
  phrase: string;
  reason: string;
};

const BLOCK_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /必ず(儲|稼|成功|売れ)/, reason: '効果の断定は優良誤認にあたる' },
  { re: /絶対に?(儲|稼|成功|売れ|失敗しない)/, reason: '効果の断定は優良誤認にあたる' },
  { re: /誰でも(簡単に)?(月|年)?\d+万/, reason: '再現性の断定は優良誤認にあたる' },
  { re: /元本保証|損はしません|リスクゼロ/, reason: '誤認を招く断定' },
  { re: /日本初|世界初|No\.?1|ナンバーワン|業界最安/, reason: '客観的根拠がなければ優良誤認' },
  { re: /通常価格[^\n]{0,20}→|定価[^\n]{0,10}\d+円[^\n]{0,10}→/, reason: '根拠のない二重価格表示' },
  { re: /残り\s*\d+\s*(名|枠|席)限定|本日限り|今だけ/, reason: '購入を急かす煽り表現' },
];

const WARN_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /稼げ(る|ます)/, reason: '収益の見込みを語る場合は前提条件と根拠を併記する' },
  { re: /simple|誰でも|すぐに/, reason: '容易性の強調は根拠とセットにする' },
  { re: /\d+倍/, reason: '倍率を出すなら出典と条件を明記する' },
];

const EXPERT_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /電話|架電|テレアポ|自動音声/, reason: '営業電話は電気通信・特商法の確認が必要' },
  { re: /メール(配信|一斉|営業)|DM一斉/, reason: '特定電子メール法（オプトイン）の確認が必要' },
  { re: /個人情報|リスト購入|名簿/, reason: '個人情報保護法の確認が必要' },
  { re: /医療|クリニック|薬|治療/, reason: '医薬品医療機器等法の確認が必要' },
  { re: /投資|金融|保険|仮想通貨/, reason: '金商法・保険業法の確認が必要' },
];

export function checkCompliance(text: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const p of BLOCK_PATTERNS) {
    const m = text.match(p.re);
    if (m) issues.push({ severity: 'BLOCK', phrase: m[0], reason: p.reason });
  }
  for (const p of WARN_PATTERNS) {
    const m = text.match(p.re);
    if (m) issues.push({ severity: 'WARN', phrase: m[0], reason: p.reason });
  }
  for (const p of EXPERT_PATTERNS) {
    const m = text.match(p.re);
    if (m) issues.push({ severity: 'EXPERT_REVIEW', phrase: m[0], reason: p.reason });
  }
  return issues;
}

export function isPublishable(text: string): boolean {
  return !checkCompliance(text).some((i) => i.severity === 'BLOCK');
}
