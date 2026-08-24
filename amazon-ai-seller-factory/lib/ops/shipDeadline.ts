import { all, insert, newId, nowIso, one, update } from '../db/client';
import { jstToday } from '../format';
import { notify } from '../providers/notification';

/**
 * 出荷期限アラート（SHIP_DEADLINE）。
 *
 * ★ユーザー指定の絶対ルール：
 *   「自己発送商品について、今日発送必要／明日発送必要／期限超過 を一覧表示してください。」
 *   「期限超過リスクがある注文を最上部に出してください。」
 *   「通知Providerにも接続してください。」
 *
 * → 出荷遅延率はアカウント停止に直結する（基準4%未満）。
 *   だから利益より先に、ここを見る。
 * → 注文データはAmazon側から自動で取れないので、CSVまたは手入力で入れる。
 */

export type ShipUrgency = 'OVERDUE' | 'TODAY' | 'TOMORROW' | 'SOON' | 'LATER' | 'SHIPPED';

export const SHIP_URGENCY_LABEL: Record<ShipUrgency, string> = {
  OVERDUE: '★期限超過',
  TODAY: '今日発送',
  TOMORROW: '明日発送',
  SOON: '3日以内',
  LATER: 'まだ余裕',
  SHIPPED: '発送済み',
};

const URGENCY_ORDER: Record<ShipUrgency, number> = {
  OVERDUE: 0,
  TODAY: 1,
  TOMORROW: 2,
  SOON: 3,
  LATER: 4,
  SHIPPED: 5,
};

export interface ShipmentInput {
  id?: string;
  orderId?: string | null;
  lifecycleId?: string | null;
  asin?: string | null;
  title?: string | null;
  buyerName?: string | null;
  qty?: number | null;
  orderedAt?: string | null;
  shipByDate: string;
  deliverByDate?: string | null;
  fulfillment?: string | null;
  note?: string | null;
}

export interface ShipmentRow {
  id: string;
  orderId: string | null;
  title: string;
  qty: number | null;
  orderedAt: string | null;
  shipByDate: string;
  deliverByDate: string | null;
  fulfillment: string;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  status: string;
  urgency: ShipUrgency;
  daysLeft: number | null;
  note: string | null;
}

/** ★発送期限は日本時間で判断する（世界標準時だと朝9時まで前日扱いになる） */
function today(now = new Date()): string {
  return jstToday(now);
}

function daysBetween(fromYmd: string, toYmd: string): number | null {
  const a = Date.parse(`${fromYmd}T00:00:00.000Z`);
  const b = Date.parse(`${toYmd}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function urgencyOf(shipByDate: string, shippedAt: string | null, now = new Date()): { urgency: ShipUrgency; daysLeft: number | null } {
  if (shippedAt) return { urgency: 'SHIPPED', daysLeft: null };
  const d = daysBetween(today(now), String(shipByDate).slice(0, 10));
  if (d == null) return { urgency: 'LATER', daysLeft: null };
  if (d < 0) return { urgency: 'OVERDUE', daysLeft: d };
  if (d === 0) return { urgency: 'TODAY', daysLeft: 0 };
  if (d === 1) return { urgency: 'TOMORROW', daysLeft: 1 };
  if (d <= 3) return { urgency: 'SOON', daysLeft: d };
  return { urgency: 'LATER', daysLeft: d };
}

/** 注文を1件登録する（CSV取込・手入力の両方から使う） */
export async function saveShipment(input: ShipmentInput): Promise<{ ok: boolean; message: string; id: string }> {
  const shipBy = String(input.shipByDate || '').slice(0, 10);
  if (!shipBy) return { ok: false, message: '発送期限の日付が必要です', id: '' };

  // 同じ注文番号があれば上書き（二重登録を防ぐ）
  const existing = input.orderId
    ? await one(`SELECT id FROM shipment_orders WHERE order_id = ?`, [input.orderId])
    : null;

  const data = {
    order_id: input.orderId ?? null,
    lifecycle_id: input.lifecycleId ?? null,
    asin: input.asin ?? null,
    title: input.title ?? null,
    buyer_name: input.buyerName ?? null,
    qty: input.qty ?? null,
    ordered_at: input.orderedAt ?? null,
    ship_by_date: shipBy,
    deliver_by_date: input.deliverByDate ?? null,
    fulfillment: input.fulfillment ?? 'FBM',
    note: input.note ?? null,
    source: 'human',
    updated_at: nowIso(),
  };

  if (existing) {
    await update('shipment_orders', String(existing.id), data);
    return { ok: true, message: `注文${input.orderId}を更新しました（発送期限${shipBy}）`, id: String(existing.id) };
  }
  const id = input.id || newId('shp');
  await insert('shipment_orders', { id, status: 'PENDING', created_at: nowIso(), ...data });
  const u = urgencyOf(shipBy, null);
  return {
    ok: true,
    message: `注文を登録しました（発送期限${shipBy}・${SHIP_URGENCY_LABEL[u.urgency]}）`,
    id,
  };
}

/** 発送済みにする（追跡番号も残す＝追跡可能率の維持） */
export async function markShipped(input: {
  id: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  shippedAt?: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const row = await one(`SELECT * FROM shipment_orders WHERE id = ?`, [input.id]);
  if (!row) return { ok: false, message: 'その注文が見つかりませんでした' };
  const shippedAt = input.shippedAt || nowIso();
  await update('shipment_orders', input.id, {
    status: 'SHIPPED',
    carrier: input.carrier ?? null,
    tracking_number: input.trackingNumber ?? null,
    shipped_at: shippedAt,
    updated_at: nowIso(),
  });
  const late = daysBetween(String(row.ship_by_date).slice(0, 10), shippedAt.slice(0, 10));
  const warn =
    late != null && late > 0
      ? `★期限を${late}日過ぎての発送です。出荷遅延率（4%未満が必須）に影響します`
      : '期限内の発送です';
  const track = input.trackingNumber
    ? ''
    : '／★追跡番号が未入力です。追跡可能率（95%以上が必須）が下がります';
  return { ok: true, message: `発送済みにしました。${warn}${track}` };
}

export async function deleteShipment(id: string): Promise<{ ok: boolean; message: string }> {
  await update('shipment_orders', id, { status: 'CANCELLED', updated_at: nowIso() });
  return { ok: true, message: 'この注文を一覧から外しました（記録は残ります）' };
}

/** 出荷待ちの一覧。★期限超過を必ず最上部に出す */
export async function shipmentQueue(limit = 200): Promise<ShipmentRow[]> {
  const rows = await all(
    `SELECT * FROM shipment_orders WHERE status != 'CANCELLED' ORDER BY ship_by_date ASC LIMIT ?`,
    [limit],
  );
  const out: ShipmentRow[] = rows.map((r: any) => {
    const shippedAt = r.shipped_at ? String(r.shipped_at) : null;
    const u = urgencyOf(String(r.ship_by_date), shippedAt);
    return {
      id: String(r.id),
      orderId: r.order_id ? String(r.order_id) : null,
      title: String(r.title ?? ''),
      qty: r.qty != null ? Number(r.qty) : null,
      orderedAt: r.ordered_at ? String(r.ordered_at) : null,
      shipByDate: String(r.ship_by_date).slice(0, 10),
      deliverByDate: r.deliver_by_date ? String(r.deliver_by_date).slice(0, 10) : null,
      fulfillment: String(r.fulfillment ?? 'FBM'),
      carrier: r.carrier ? String(r.carrier) : null,
      trackingNumber: r.tracking_number ? String(r.tracking_number) : null,
      shippedAt,
      status: String(r.status ?? 'PENDING'),
      urgency: u.urgency,
      daysLeft: u.daysLeft,
      note: r.note ? String(r.note) : null,
    };
  });
  out.sort((a, b) => {
    const o = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (o !== 0) return o;
    return a.shipByDate.localeCompare(b.shipByDate);
  });
  return out;
}

export interface ShipSummary {
  overdue: number;
  today: number;
  tomorrow: number;
  soon: number;
  pending: number;
  noTracking: number;
  headline: string;
}

export async function shipSummary(): Promise<ShipSummary> {
  const rows = await shipmentQueue(500);
  const pending = rows.filter((r) => r.status === 'PENDING');
  const overdue = pending.filter((r) => r.urgency === 'OVERDUE').length;
  const t = pending.filter((r) => r.urgency === 'TODAY').length;
  const tm = pending.filter((r) => r.urgency === 'TOMORROW').length;
  const soon = pending.filter((r) => r.urgency === 'SOON').length;
  const noTracking = rows.filter((r) => r.status === 'SHIPPED' && !r.trackingNumber).length;

  let headline: string;
  if (overdue > 0) {
    headline = `★発送期限を過ぎた注文が${overdue}件あります。いますぐ発送してください（出荷遅延率はアカウント停止に直結します）`;
  } else if (t > 0) {
    headline = `今日中に発送する注文が${t}件あります`;
  } else if (tm > 0) {
    headline = `明日発送の注文が${tm}件あります`;
  } else if (pending.length === 0) {
    headline = '発送待ちの注文はありません';
  } else {
    headline = `発送待ちは${pending.length}件。差し迫ったものはありません`;
  }

  return { overdue, today: t, tomorrow: tm, soon, pending: pending.length, noTracking, headline };
}

/** 期限が近い・過ぎている注文を通知する（1日1回のジョブから呼ぶ想定） */
export async function notifyShipDeadlines(): Promise<{ sent: boolean; summary: ShipSummary }> {
  const s = await shipSummary();
  if (s.overdue === 0 && s.today === 0) return { sent: false, summary: s };
  const rows = (await shipmentQueue(50)).filter(
    (r) => r.status === 'PENDING' && (r.urgency === 'OVERDUE' || r.urgency === 'TODAY'),
  );
  const body = rows
    .slice(0, 20)
    .map((r) => `・${SHIP_URGENCY_LABEL[r.urgency]} ${r.shipByDate} ${r.title.slice(0, 24)}（${r.orderId ?? '注文番号なし'}）`)
    .join('\n');
  await notify({
    kind: 'ship_deadline',
    title: s.headline,
    body: body || s.headline,
  });
  return { sent: true, summary: s };
}
