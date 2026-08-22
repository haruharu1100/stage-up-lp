import { all, nowIso, run } from './db/client';
import type { Idea, Product, ProductLevel } from './types';

/**
 * 1つの調査を1商品で終わらせない。無料露出から月額契約・代行まで一本の線にする。
 * 価格は通常価格のみを扱い、二重価格・煽り表示は作らない（景表法）。
 */
export const LADDER: {
  level: ProductLevel;
  kind: string;
  name: (t: string) => string;
  priceYen: number;
  goal: string;
}[] = [
  { level: 0, kind: 'X_POST', name: (t) => `${t}｜X無料投稿`, priceYen: 0, goal: '認知と入口' },
  { level: 1, kind: 'FREE_NOTE', name: (t) => `${t}｜無料note`, priceYen: 0, goal: 'メール/フォロー獲得' },
  { level: 2, kind: 'NOTE_ENTRY', name: (t) => `${t}｜入門note`, priceYen: 980, goal: '最初の購入体験' },
  { level: 3, kind: 'NOTE_PRACTICE', name: (t) => `${t}｜実践note`, priceYen: 2980, goal: '本気層の抽出' },
  { level: 4, kind: 'FULL_COURSE', name: (t) => `${t}｜完全版教材`, priceYen: 9800, goal: '高単価購入者の特定' },
  { level: 5, kind: 'FREE_DEMO', name: (t) => `${t}｜無料AIデモ`, priceYen: 0, goal: '体験させて欲しさを作る' },
  { level: 6, kind: 'SYSTEM_SALE', name: (t) => `${t}｜AIシステム導入`, priceYen: 298000, goal: '初期導入売上' },
  { level: 7, kind: 'MONTHLY_AI', name: (t) => `${t}｜月額AI社員 STANDARD`, priceYen: 49800, goal: '継続収益(MRR)' },
  { level: 8, kind: 'OPERATION', name: (t) => `${t}｜運用代行`, priceYen: 98000, goal: '手離れと単価向上' },
  { level: 9, kind: 'CONSULTING', name: (t) => `${t}｜コンサル/OEM`, priceYen: 0, goal: '個別見積・最上位' },
];

export const CONTRACT_PLANS = [
  { plan: 'LIGHT', monthlyYen: 29800 },
  { plan: 'STANDARD', monthlyYen: 49800 },
  { plan: 'PRO', monthlyYen: 98000 },
  { plan: 'ENTERPRISE', monthlyYen: 0 }, // 個別見積
];

export async function buildLadder(idea: Idea): Promise<Product[]> {
  const createdAt = nowIso();
  const created: Product[] = [];

  for (let i = 0; i < LADDER.length; i++) {
    const l = LADDER[i];
    const id = `${idea.id}_L${l.level}`;
    const next = i + 1 < LADDER.length ? `${idea.id}_L${LADDER[i + 1].level}` : null;
    await run(
      `INSERT INTO products (id, idea_id, level, name, price_yen, kind, next_product_id, created_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, price_yen=excluded.price_yen,
         kind=excluded.kind, next_product_id=excluded.next_product_id`,
      [id, idea.id, l.level, l.name(idea.title), l.priceYen, l.kind, next, createdAt]
    );
    created.push({
      id,
      ideaId: idea.id,
      level: l.level,
      name: l.name(idea.title),
      priceYen: l.priceYen,
      kind: l.kind,
      nextProductId: next,
      createdAt,
    });
  }
  return created;
}

export async function listProducts(ideaId: string): Promise<Product[]> {
  const rows = await all<{
    id: string;
    idea_id: string;
    level: number;
    name: string;
    price_yen: number;
    kind: string;
    next_product_id: string | null;
    created_at: string;
  }>('SELECT * FROM products WHERE idea_id = ? ORDER BY level', [ideaId]);
  return rows.map((r) => ({
    id: r.id,
    ideaId: r.idea_id,
    level: r.level as ProductLevel,
    name: r.name,
    priceYen: r.price_yen,
    kind: r.kind,
    nextProductId: r.next_product_id,
    createdAt: r.created_at,
  }));
}
