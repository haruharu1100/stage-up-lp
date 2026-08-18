import { nowIso, one } from './db.js';
import { createCtx, newPublicId, newToken } from './tenant-db.js';
import { buildReceipt, buildKitchenTicket, buildTestTicket } from './domain/receipt.js';

/**
 * プリンター連携（Star CloudPRNT 方式）。
 *
 * なぜこの方式か：
 *   店の会計画面は https のクラウド上にある。一方プリンターは店内LANの中。
 *   ブラウザから店内のプリンターへ直接つなぐ方式は、通信の安全設定に阻まれて
 *   実店舗ではほぼ動かない（社内PCの常駐ソフトが必要になる）。
 *   CloudPRNTは逆で、プリンターの側が数秒おきにこのサーバーへ
 *   「印刷するものある？」と聞きに来る。だから店側の設定はURLを1つ入れるだけで済み、
 *   パソコンも常駐ソフトもルーターの設定変更も要らない。
 *
 * 設計の要点：
 *   印刷の失敗で、注文や会計そのものを失敗させない（紙は後から出し直せるが、注文は消えたら終わり）。
 *   だから enqueue 系は必ず例外を飲み込む。印刷待ちは消さずに残し、あとから再送できる。
 */

const KINDS = ['receipt', 'kitchen'];

export function printerToken() {
  return newToken();
}

/**
 * プリンターは自分がどの店のものか名乗れない（ログインできない）ので、
 * URLに埋めた合言葉から店を特定する。合言葉はテナントをまたいで一意。
 * ここ以外で SCOPE 無しの検索を書かないこと。
 */
export async function resolvePrinterToken(token) {
  if (!token || typeof token !== 'string' || token.length < 8) return null;
  const printer = await one('SELECT * FROM printers WHERE token = ?', [token]);
  if (!printer || Number(printer.active) !== 1) return null;
  const store = await one('SELECT * FROM stores WHERE id = ?', [Number(printer.store_id)]);
  if (!store || store.status !== 'active') return null;
  const ctx = createCtx({
    tenantId: Number(printer.tenant_id),
    storeId: Number(printer.store_id),
    role: 'system',
    staffName: `プリンター（${printer.name}）`,
    store,
  });
  return { printer, store, ctx };
}

async function printersFor(ctx, kind, station = '') {
  const rows = await ctx.query(
    'SELECT * FROM printers WHERE SCOPE() AND kind = ? AND active = 1 ORDER BY id',
    [kind]
  );
  if (kind !== 'kitchen') return rows;
  // 受け持ちを指定していないプリンターは「全部の場所」を引き受ける。
  // 焼き場のプリンターだけ増やした店で、ドリンクの伝票が消えないようにするため。
  return rows.filter((p) => {
    const list = String(p.stations || '').split(',').map((s) => s.trim()).filter(Boolean);
    return !list.length || list.includes(String(station));
  });
}

async function push(ctx, printer, { kind, title, body }) {
  const copies = Math.max(1, Math.min(3, Number(printer.copies) || 1));
  for (let i = 0; i < copies; i++) {
    await ctx.insert('print_jobs', {
      printer_id: Number(printer.id),
      kind,
      title: String(title || '').slice(0, 100),
      body,
      status: 'queued',
      created_at: nowIso(),
    });
  }
}

/** お客様にお渡しするレシート。会計が終わった直後に呼ぶ */
export async function enqueueReceipt(ctx, check) {
  try {
    const list = await printersFor(ctx, 'receipt');
    for (const p of list) {
      await push(ctx, p, {
        kind: 'receipt',
        title: `レシート ${check.tableName || ''} ${Number(check.total || 0).toLocaleString()}円`,
        body: buildReceipt(check, { width: Number(p.width) || 80 }),
      });
    }
    return list.length;
  } catch (e) {
    // 紙が出せなくても会計は成立させる。画面には金額が出ているので手書きで渡せる。
    console.error('[print] レシートの印刷待ちに入れられませんでした', e?.message || e);
    return 0;
  }
}

/** 厨房への注文票。提供場所ごとに1枚ずつ分ける */
export async function enqueueKitchen(ctx, { tableName, orderId, source, createdAt, items }) {
  try {
    const byStation = new Map();
    for (const i of items || []) {
      const st = String(i.station || 'kitchen');
      if (!byStation.has(st)) byStation.set(st, []);
      byStation.get(st).push(i);
    }
    let n = 0;
    for (const [station, list] of byStation) {
      const targets = await printersFor(ctx, 'kitchen', station);
      for (const p of targets) {
        await push(ctx, p, {
          kind: 'kitchen',
          title: `${tableName || ''}番卓 ${list.length}品`,
          body: buildKitchenTicket(
            { station, tableName, orderId, source, createdAt, items: list },
            { width: Number(p.width) || 80 }
          ),
        });
        n++;
      }
    }
    return n;
  } catch (e) {
    // 注文そのものはKDS（厨房の画面）に必ず出ている。紙が出ないだけで料理は作れる。
    console.error('[print] 厨房伝票の印刷待ちに入れられませんでした', e?.message || e);
    return 0;
  }
}

export async function enqueueTest(ctx, printer) {
  await push(ctx, printer, {
    kind: printer.kind === 'kitchen' ? 'kitchen' : 'receipt',
    title: 'テスト印刷',
    body: buildTestTicket(printer.name, { width: Number(printer.width) || 80 }),
  });
}

export async function enqueueRaw(ctx, printer, { kind = 'receipt', title = '', body }) {
  await push(ctx, printer, { kind, title, body });
}

export { KINDS, newPublicId };
