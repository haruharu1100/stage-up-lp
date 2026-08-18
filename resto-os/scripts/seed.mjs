// 初期データ投入: npm run seed
// デモ用の契約(テナント)を2つ作る。2つ目は「他店の情報が見えないこと」を確かめるための比較用。
import { run, all, one, initDb, nowIso } from '../lib/db.js';
import { createCtx, newPublicId, newToken } from '../lib/tenant-db.js';
import { hashSecret } from '../lib/hash.js';

const CATEGORIES = [
  ['おすすめ', 1],
  ['ドリンク', 2],
  ['前菜・サラダ', 3],
  ['刺身', 4],
  ['焼き物', 5],
  ['揚げ物', 6],
  ['ご飯もの', 7],
  ['デザート', 8],
];

const SIZE_OPT = JSON.stringify([
  { name: 'サイズ', type: 'single', required: false, choices: [{ label: '普通', price: 0 }, { label: '大盛り', price: 150 }, { label: '小盛り', price: -80 }] },
]);
const TOPPING_OPT = JSON.stringify([
  { name: 'トッピング', type: 'multi', required: false, choices: [{ label: 'マヨネーズ', price: 50 }, { label: 'チーズ', price: 120 }, { label: '追加レモン', price: 30 }] },
]);
const SET_OPT = JSON.stringify([
  { name: 'セット', type: 'single', required: true, choices: [{ label: '単品', price: 0 }, { label: '味噌汁セット', price: 200 }, { label: '小鉢＋味噌汁セット', price: 350 }] },
]);
const DRINK_SIZE = JSON.stringify([
  { name: 'サイズ', type: 'single', required: false, choices: [{ label: '中ジョッキ', price: 0 }, { label: '大ジョッキ', price: 250 }] },
]);

// name, cat, price, cost, emoji, station, desc, allergens, kcal, spicy, new, reco, options, pair_with, pair_message
const ITEMS = [
  ['生ビール', 'ドリンク', 650, 190, '🍺', 'drink', 'キンキンに冷えた一杯。まずは乾杯から。', '', 145, 0, 0, 1, DRINK_SIZE, '枝豆', ''],
  ['ハイボール', 'ドリンク', 480, 120, '🥃', 'drink', '国産ウイスキーの濃いめハイボール。', '', 110, 0, 0, 1, '', '', ''],
  ['レモンサワー', 'ドリンク', 450, 110, '🍋', 'drink', '生レモンを絞る爽やかサワー。', '', 130, 0, 0, 0, '', '', ''],
  ['梅酒ロック', 'ドリンク', 520, 150, '🍶', 'drink', '香り高い紀州梅酒をロックで。', '', 160, 0, 0, 0, '', '', ''],
  ['日本酒（冷）', 'ドリンク', 780, 260, '🍶', 'drink', '本日の地酒を一合で。', '', 190, 0, 1, 0, '', '刺身盛り合わせ', '日本酒には刺身盛り合わせがよく合います'],
  ['ウーロン茶', 'ドリンク', 350, 40, '🍵', 'drink', 'お食事のお供に。', '', 0, 0, 0, 0, '', '', ''],

  ['枝豆', '前菜・サラダ', 380, 90, '🫛', 'kitchen', '塩加減にこだわった定番のおつまみ。', '', 130, 0, 0, 0, '', '生ビール', '枝豆と一緒に生ビールはいかがですか？'],
  ['冷やしトマト', '前菜・サラダ', 420, 110, '🍅', 'kitchen', '完熟トマトを冷たいまま。', '', 60, 0, 0, 0, '', '', ''],
  ['シーザーサラダ', '前菜・サラダ', 680, 200, '🥗', 'kitchen', 'パルメザンとクルトンをたっぷり。', '乳,小麦,卵', 280, 0, 0, 0, TOPPING_OPT, '', ''],

  ['刺身盛り合わせ', '刺身', 1580, 620, '🍣', 'sashimi', '本日の鮮魚を5種盛りで。', '', 320, 0, 0, 1, '', '日本酒（冷）', '刺身に日本酒を合わせてみませんか？'],
  ['サーモン刺身', '刺身', 780, 310, '🐟', 'sashimi', '脂ののったトロサーモン。', '', 240, 0, 0, 0, '', '', ''],
  ['本日の鮮魚', '刺身', 980, 400, '🐡', 'sashimi', '市場から届いた旬の一皿。', '', 210, 0, 1, 0, '', '', ''],

  ['焼き鳥5本盛り', '焼き物', 880, 300, '🍢', 'grill', 'もも・ねぎま・つくね・皮・砂肝。', '', 480, 0, 0, 1, '', 'ハイボール', '焼き鳥にはハイボールがおすすめです'],
  ['厚切り牛タン', '焼き物', 1280, 560, '🥩', 'grill', '厚切りで旨みを閉じ込めた自慢の一品。', '', 390, 0, 0, 1, '', '', ''],
  ['手羽先', '焼き物', 580, 180, '🍗', 'grill', 'ピリ辛スパイスで香ばしく。', '小麦', 340, 2, 0, 0, '', '', ''],

  ['鶏の唐揚げ', '揚げ物', 780, 260, '🍤', 'kitchen', '外はカリッと中はジューシー。', '小麦,卵', 520, 0, 0, 1, TOPPING_OPT, 'ハイボール', '唐揚げと一緒にハイボールはいかがですか？'],
  ['ポテトフライ', '揚げ物', 480, 120, '🍟', 'kitchen', 'みんなで分けられる大皿サイズ。', '', 410, 0, 0, 0, SIZE_OPT, '', ''],
  ['串カツ盛り', '揚げ物', 880, 320, '🍡', 'kitchen', '定番5種の串カツ盛り合わせ。', '小麦,卵', 560, 1, 0, 0, '', '', ''],

  ['炙りサーモンとイクラの親子丼', 'ご飯もの', 1280, 480, '🍚', 'kitchen', '炙りサーモンにイクラをのせた贅沢丼。', '', 620, 0, 1, 1, SET_OPT, '', ''],
  ['焼きおにぎり', 'ご飯もの', 380, 90, '🍙', 'grill', '香ばしい醤油の焼きおにぎり2個。', '大豆', 320, 0, 0, 0, '', '', ''],
  ['だし茶漬け', 'ご飯もの', 580, 160, '🍜', 'kitchen', 'シメにうれしいあっさり出汁。', '大豆', 260, 0, 0, 0, '', '', ''],

  ['バニラアイス', 'デザート', 380, 100, '🍨', 'dessert', '濃厚バニラのシンプルアイス。', '乳', 210, 0, 0, 0, '', '', ''],
  ['抹茶パフェ', 'デザート', 680, 230, '🍧', 'dessert', '宇治抹茶と白玉の和パフェ。', '乳,小麦', 430, 0, 0, 1, '', '', ''],
];

const COUPONS = [
  ['WELCOME100', 'LINE友だち追加 100円OFF', 'amount', 100, 0, '会計時のQRからLINE登録した方向け'],
  ['LINE10', 'LINEクーポン 10%OFF', 'percent', 10, 5000, '5,000円以上のお会計で利用可'],
  ['RAIN500', '雨の日クーポン 500円OFF', 'amount', 500, 3000, '雨天日限定'],
  ['DRINK1', 'ドリンク1杯無料（500円分）', 'amount', 500, 2000, '2,000円以上のお会計で利用可'],
];

const STAFF = [
  ['オーナー 山田', 'owner', 'owner@demo.test', 'demo1234', '1111'],
  ['管理者 佐藤', 'admin', 'admin@demo.test', 'demo1234', '2222'],
  ['店長 鈴木', 'manager', 'manager@demo.test', 'demo1234', '3333'],
  ['ホール 田中', 'staff', null, null, '4444'],
  ['厨房 高橋', 'kitchen', null, null, '5555'],
];

async function createTenant({ name, plan, storeName, genre }) {
  const ts = nowIso();
  const t = await run('INSERT INTO tenants (public_id,name,plan,status,trial_ends_at,created_at) VALUES (?,?,?,?,?,?)', [
    newPublicId('tn'), name, plan, 'trial', new Date(Date.now() + 30 * 86400000).toISOString(), ts,
  ]);
  const tenantId = Number(t.lastInsertRowid);
  const c = await run('INSERT INTO companies (public_id,tenant_id,name,created_at) VALUES (?,?,?,?)', [
    newPublicId('cp'), tenantId, name, ts,
  ]);
  const companyId = Number(c.lastInsertRowid);
  const storeCode = newPublicId('st');
  const s = await run(
    'INSERT INTO stores (public_id,tenant_id,company_id,name,genre,created_at) VALUES (?,?,?,?,?,?)',
    [storeCode, tenantId, companyId, storeName, genre, ts]
  );
  return { tenantId, companyId, storeId: Number(s.lastInsertRowid), storeCode };
}

async function fillStore({ tenantId, storeId }, { items, tableCount, withCoupons }) {
  const ctx = createCtx({ tenantId, storeId, role: 'owner' });

  for (const [name, sort] of CATEGORIES) await ctx.insert('categories', { name, sort_order: sort });
  const cats = await ctx.query('SELECT id, name FROM categories WHERE SCOPE()');
  const catId = (n) => Number(cats.find((c) => c.name === n)?.id) || null;

  let sort = 0;
  for (const it of items) {
    const [name, cat, price, cost, emoji, station, desc, allergens, kcal, spicy, isNew, reco, options, pairWith, pairMsg] = it;
    await ctx.insert('menu_items', {
      public_id: newPublicId('mi'),
      category_id: catId(cat), name, description: desc, price, cost, emoji, station,
      allergens, calories: kcal, spicy, is_new: isNew, is_recommended: reco,
      options_json: options || '[]', pair_with: pairWith, pair_message: pairMsg, sort_order: ++sort,
    });
  }

  for (let i = 1; i <= tableCount; i++) {
    await ctx.insert('tables', {
      public_id: newPublicId('tb'), name: String(i), seats: i <= 8 ? 4 : 6, token: newToken(), sort_order: i,
    });
  }
  await ctx.insert('tables', { public_id: newPublicId('tb'), name: 'カウンター1', seats: 1, token: newToken(), sort_order: 90 });
  await ctx.insert('tables', { public_id: newPublicId('tb'), name: 'カウンター2', seats: 1, token: newToken(), sort_order: 91 });

  if (withCoupons) {
    for (const [code, name, kind, value, min, note] of COUPONS) {
      await ctx.insert('coupons', { code, name, kind, value, min_amount: min, note, active: 1 });
    }
  }
  return ctx;
}

async function createStaff({ tenantId, storeId }, list, suffix = '') {
  const ts = nowIso();
  for (const [name, role, email, password, pin] of list) {
    await run(
      `INSERT INTO staff (public_id,tenant_id,store_id,name,role,email,password_hash,pin_hash,active,created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?)`,
      [
        newPublicId('sf'), tenantId, storeId, name, role,
        email ? email.replace('@', `${suffix}@`) : null,
        password ? hashSecret(password) : null,
        pin ? hashSecret(pin) : null,
        ts,
      ]
    );
  }
}

async function main() {
  await initDb();
  const existing = await one('SELECT COUNT(*) AS c FROM tenants');
  if (Number(existing.c) > 0) {
    console.log('既にデータがあります。作り直す場合は data/resto.db を削除してから実行してください。');
    return;
  }

  // ── 本編：デモ店舗
  const demo = await createTenant({ name: 'デモ飲食店グループ', plan: 'ai', storeName: 'ごろごろ居酒屋 難波店', genre: 'izakaya' });
  const ctx = await fillStore(demo, { items: ITEMS, tableCount: 12, withCoupons: true });
  await createStaff(demo, STAFF);
  await run('INSERT OR REPLACE INTO settings (tenant_id,store_id,key,value) VALUES (?,?,?,?)', [
    demo.tenantId, demo.storeId, 'shop_name', 'ごろごろ居酒屋 難波店',
  ]);

  // ── 比較用：まったく別の契約（この店のデータが上の店から見えないことを確かめるため）
  const other = await createTenant({ name: '別会社サンプル', plan: 'light', storeName: 'よその店 梅田店', genre: 'ramen' });
  await fillStore(other, { items: ITEMS.slice(0, 5), tableCount: 3, withCoupons: false });
  await createStaff(other, [['オーナー 別会社', 'owner', 'owner@demo.test', 'demo1234', '1111']], '2');

  const tables = await ctx.query('SELECT name, token FROM tables WHERE SCOPE() ORDER BY sort_order LIMIT 3');

  console.log('');
  console.log('初期データを作成しました。');
  console.log(`  店舗: ごろごろ居酒屋 難波店 / 店舗コード: ${demo.storeCode}`);
  console.log(`  商品${ITEMS.length}点 / テーブル14卓（12卓＋カウンター2） / クーポン4種`);
  console.log('');
  console.log('  ログイン（メール + パスワード）  ※デモ用の仮パスワードです。本番では必ず変更してください');
  for (const [name, role, email, password] of STAFF) {
    if (email) console.log(`    ${role.padEnd(8)} ${email}  /  ${password}   (${name})`);
  }
  console.log('  ハンディ・厨房（店舗コード + PIN）');
  for (const [name, role, , , pin] of STAFF) console.log(`    ${role.padEnd(8)} PIN ${pin}   (${name})`);
  console.log('');
  console.log('  お客様用QRのURL（テスト用）');
  for (const t of tables) console.log(`    ${t.name}番テーブル: /t/${t.token}`);
  console.log('');
  console.log('  比較用のもう1店舗（データが混ざっていないか確かめる用）');
  console.log(`    よその店 梅田店 / 店舗コード: ${other.storeCode}`);
  console.log('    owner2@demo.test  /  demo1234   (PIN 1111)');
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
