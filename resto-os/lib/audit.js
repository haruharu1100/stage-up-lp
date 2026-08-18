import { run, nowIso } from './db.js';
import { requestMeta } from './auth.js';

/**
 * 操作ログ。追記のみで、更新・削除はできない（アプリ側でも用意しない）。
 * 設計書: docs/03_DB設計.md 4-4 / docs/01_システム設計書.md 12-4
 */

export const AUDIT_LABEL = {
  'auth.login': 'ログイン',
  'auth.login_failed': 'ログイン失敗',
  'auth.pin_login': 'PINログイン',
  'auth.logout': 'ログアウト',
  'order.void': '注文取消',
  'order.partial_void': '数量の一部取消',
  'order.status': '提供状態の変更',
  'order.move': '席移動・卓の合流',
  'order.otoshi': 'お通しの自動付与',
  'store.update': 'お店の設定変更',
  'check.close': '会計',
  'check.split': '部分会計（分割）',
  'check.void': '会計取消',
  'check.refund': '返金',
  'check.discount': '値引き',
  'day.close': '日次締め',
  'menu.create': '商品追加',
  'menu.update': '商品変更',
  'menu.price_change': '価格変更',
  'menu.delete': '商品削除',
  'menu.soldout': '売り切れ切替',
  'coupon.create': 'クーポン追加',
  'coupon.update': 'クーポン変更',
  'table.create': 'テーブル追加',
  'table.update': 'テーブル変更',
  'table.delete': 'テーブル削除',
  'table.open': '来店（着席）',
  'table.close': '空席にする',
  'table.regenerate_qr': 'QR再発行',
  'staff.create': 'スタッフ追加',
  'staff.update': 'スタッフ変更',
  'staff.activate': 'スタッフ再開',
  'staff.deactivate': 'スタッフ停止',
  'staff.delete': 'スタッフ削除',
  'printer.create': 'プリンター追加',
  'printer.update': 'プリンター設定変更',
  'printer.regenerate': 'プリンター用URLの再発行',
  'printer.delete': 'プリンター削除',
  'settings.update': '店舗設定変更',
  'event.create': 'その日の出来事の登録',
  'event.delete': 'その日の出来事の取消',
  'campaign.create': '企画・販促の登録',
  'campaign.delete': '企画・販促の取消',
  'history.import': '過去データの取り込み',
  'report.settings': 'レポート設定の変更',
  'report.run': 'レポートの作成',
  'report.send': 'レポートの送信',
  'ask.question': '言葉で聞ける検索',
  'tenant.cross_access_denied': '他店舗への不正アクセス試行',
};

export async function logAudit(ctx, { action, targetType = '', targetId = '', before = null, after = null, reason = '' }) {
  let meta = { ip: '', userAgent: '' };
  try { meta = requestMeta(); } catch {}
  await run(
    `INSERT INTO audit_logs
      (tenant_id, store_id, actor_id, actor_name, actor_role, action, target_type, target_id,
       before_json, after_json, reason, ip, user_agent, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ctx.tenantId, ctx.storeId, ctx.staffId, ctx.staffName || '', ctx.role || '',
      action, String(targetType), String(targetId ?? ''),
      before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '',
      String(reason || '').slice(0, 300), meta.ip, meta.userAgent, nowIso(),
    ]
  );
}

/** ログイン前など ctx が無い場面用 */
export async function logAuditRaw({ tenantId = 0, storeId = 0, actorName = '', action, targetId = '', reason = '' }) {
  let meta = { ip: '', userAgent: '' };
  try { meta = requestMeta(); } catch {}
  await run(
    `INSERT INTO audit_logs
      (tenant_id, store_id, actor_id, actor_name, actor_role, action, target_type, target_id,
       before_json, after_json, reason, ip, user_agent, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [tenantId, storeId, null, actorName, '', action, '', String(targetId), '', '', reason, meta.ip, meta.userAgent, nowIso()]
  );
}
