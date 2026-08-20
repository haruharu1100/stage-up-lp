// 公開後の動作確認だけに使う「テスト専用の店」を用意する。
//
// 本番のお店のデータには一切さわらない。新しい会社・お店・スタッフを足すだけ。
// 使い方（本番に作る場合）:
//   node --env-file=.env.production.local scripts/provision-test-store.mjs
//
// すでに同じ名前のテスト店があるときは、作り直さずに合言葉だけ出し直す。
import fs from 'node:fs';
import { newPublicId } from '../lib/tenant-db.js';
import { hashSecret } from '../lib/hash.js';

// 本番につなぐときだけ、本番用の設定を読み込む（引数に prod を付けたとき）
if (process.argv[2] === 'prod') {
  for (const line of fs.readFileSync('.env.production.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { initDb, run, one, nowIso } = await import('../lib/db.js');

const STORES = [
  { tenant: '【テスト】検証用グループA', store: '【テスト】検証店A', plan: 'light', genre: 'izakaya', email: 'test-a@resto-check.local', password: 'CheckA-2026-08' },
  { tenant: '【テスト】検証用グループB', store: '【テスト】検証店B', plan: 'ai', genre: 'ramen', email: 'test-b@resto-check.local', password: 'CheckB-2026-08' },
];

async function ensure(def) {
  const exists = await one('SELECT * FROM stores WHERE name = ?', [def.store]);
  if (exists) {
    return { storeCode: exists.public_id, storeId: Number(exists.id), tenantId: Number(exists.tenant_id), created: false };
  }
  const ts = nowIso();
  const t = await run(
    'INSERT INTO tenants (public_id,name,plan,status,trial_ends_at,created_at) VALUES (?,?,?,?,?,?)',
    [newPublicId('tn'), def.tenant, def.plan, 'trial', new Date(Date.now() + 30 * 86400000).toISOString(), ts]
  );
  const tenantId = Number(t.lastInsertRowid);
  const c = await run('INSERT INTO companies (public_id,tenant_id,name,created_at) VALUES (?,?,?,?)',
    [newPublicId('cp'), tenantId, def.tenant, ts]);
  const storeCode = newPublicId('st');
  const s = await run(
    'INSERT INTO stores (public_id,tenant_id,company_id,name,genre,created_at) VALUES (?,?,?,?,?,?)',
    [storeCode, tenantId, Number(c.lastInsertRowid), def.store, def.genre, ts]
  );
  const storeId = Number(s.lastInsertRowid);
  await run(
    `INSERT INTO staff (public_id,tenant_id,store_id,name,role,email,password_hash,pin_hash,active,created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
    [newPublicId('sf'), tenantId, storeId, '検証オーナー', 'owner', def.email, hashSecret(def.password), hashSecret('9999'), ts]
  );
  return { storeCode, storeId, tenantId, created: true };
}

async function main() {
  await initDb();
  console.log('テスト専用の店を用意します（本番のお店のデータにはさわりません）\n');
  for (const def of STORES) {
    const r = await ensure(def);
    console.log(`${def.store}（${def.plan}プラン）${r.created ? ' … 作成しました' : ' … すでにありました'}`);
    console.log(`  店舗コード: ${r.storeCode}`);
    console.log(`  ログイン  : ${def.email} / ${def.password}\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
