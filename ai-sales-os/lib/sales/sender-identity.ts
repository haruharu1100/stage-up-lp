/**
 * 特定電子メール法で、営業メールの本文に必ず入れなければならない項目。
 *
 * 1つでも欠けたら、その下書きは BLOCKED にする。
 * 「あとで足す」ができない項目なので、文面を作る段階で止める。
 */
export type SenderIdentity = {
  name: string;
  address: string;
  email: string;
  unsubscribeUrl: string;
};

export type IdentityCheck =
  | { ok: true; identity: SenderIdentity }
  | { ok: false; missing: string[]; reasonJa: string };

const FIELDS: { env: string; label: string; key: keyof SenderIdentity }[] = [
  { env: 'SENDER_NAME', label: '送信者の氏名または名称', key: 'name' },
  { env: 'SENDER_ADDRESS', label: '住所', key: 'address' },
  { env: 'SENDER_EMAIL', label: '苦情・問い合わせを受け付けるメールアドレス', key: 'email' },
  { env: 'SENDER_UNSUBSCRIBE_URL', label: '配信停止の受付先', key: 'unsubscribeUrl' },
];

export function senderIdentity(): IdentityCheck {
  const got: Partial<SenderIdentity> = {};
  const missing: string[] = [];
  for (const f of FIELDS) {
    const v = (process.env[f.env] ?? '').trim();
    if (!v) missing.push(f.label);
    else got[f.key] = v;
  }
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reasonJa: `営業メールに必ず入れる項目が足りない（${missing.join('・')}）。.env に入れるまでメールの下書きは作らない。`,
    };
  }
  return { ok: true, identity: got as SenderIdentity };
}

export function legalFooter(id: SenderIdentity): string {
  return [
    '------------------------------------------',
    `${id.name}`,
    `${id.address}`,
    `お問い合わせ: ${id.email}`,
    `今後このご案内が不要な場合はこちら: ${id.unsubscribeUrl}`,
    '------------------------------------------',
  ].join('\n');
}
