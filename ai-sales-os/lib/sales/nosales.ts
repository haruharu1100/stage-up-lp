/**
 * 「営業お断り」の表記を見つける。
 *
 * ここで見つけた会社には、電話もメールもフォームも一切送らない。
 * 見つからなかった場合でも「確認済み」にはしない。
 * HP本文を読んでいなければ、それは「無い」ではなく「調べていない」なので、
 * 呼び出し側で checked=false として扱う。
 */

const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /営業.{0,4}(お断り|ご遠慮|お受けしておりません|は受け付けており?ません)/, label: '営業お断り' },
  { re: /(セールス|勧誘).{0,6}(お断り|ご遠慮|お受けしておりません)/, label: '勧誘お断り' },
  { re: /営業目的.{0,12}(利用|使用|送信).{0,8}(禁止|お断り|ご遠慮)/, label: '営業目的の利用禁止' },
  // 「営業目的のお問い合わせはお断りしております」のように、営業 と お断り の間に
  // 用件の説明が入る書き方。ここが拾えないと、断っている会社へ営業してしまう。
  { re: /営業目的.{0,20}(お断り|ご遠慮|禁止|お受けしており?ません|受け付けており?ません)/, label: '営業目的のご連絡お断り' },
  { re: /売り込み.{0,6}(お断り|ご遠慮)/, label: '売り込みお断り' },
  { re: /(営業|セールス).{0,6}(メール|電話|ＦＡＸ|fax).{0,8}(お断り|ご遠慮|禁止)/i, label: '営業メール/電話お断り' },
  { re: /当社(への|に対する)?.{0,8}(営業|勧誘).{0,8}(固くお断り|一切お断り)/, label: '営業を固くお断り' },
  { re: /取引.{0,4}(目的|以外).{0,10}(以外|除く).{0,10}(お断り|ご遠慮)/, label: '取引目的以外お断り' },
];

export function detectNoSales(text: string | null | undefined): { found: boolean; evidence: string | null; label: string | null } {
  if (!text || !text.trim()) return { found: false, evidence: null, label: null };
  const t = text.normalize('NFKC').replace(/\s+/g, '');
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (m) {
      const idx = t.indexOf(m[0]);
      const around = t.slice(Math.max(0, idx - 20), Math.min(t.length, idx + m[0].length + 20));
      return { found: true, evidence: around, label: p.label };
    }
  }
  return { found: false, evidence: null, label: null };
}
