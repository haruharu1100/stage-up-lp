import fs from 'node:fs';
import path from 'node:path';
import { all, insert, newId, nowIso, one, update } from '../db/client';
import { PROJECT_ROOT, config } from '../env';

/**
 * 大事なデータの定期バックアップ。
 *
 * ★ユーザー指定の絶対ルール：
 *   「重要テーブルを定期バックアップしてください。」
 *   「今後このシステムの一番価値が高くなるものは『自社販売実績DB』です。
 *     ここを絶対に壊さないでください。」
 *
 * → 買い直せないデータ（承認の履歴・仕入れた記録・売れた実績・広告実績・
 *   予測と実績のズレ・学習した重み・ランクが動いた理由）を、
 *   人が読める形（1行1件のテキスト）で書き出して残す。
 *
 * ★安全のためのきまり
 *   ・バックアップは「書き出すだけ」。元のデータには一切さわらない。
 *   ・古い世代を消すときも、消すのはバックアップの写しだけ。本体は消さない。
 *   ・失敗しても本流は止めない。失敗したことを記録して次に進む。
 */

export interface CriticalTable {
  table: string;
  label: string;
  /** なぜ大事なのか（画面に出す） */
  why: string;
  /** 買い直せない＝失うと二度と戻らないデータ */
  irreplaceable: boolean;
}

/**
 * ★守る対象。ユーザー指定の7種をすべて含む。
 *   （承認スナップショット／仕入記録／販売実績／広告実績／予測結果／
 *     学習データ／Research Score変更履歴）
 */
export const CRITICAL_TABLES: CriticalTable[] = [
  {
    table: 'product_lifecycle',
    label: '商品の一生（承認・仕入・販売の実績）',
    why: '承認したときの数字と、実際に売れた数字が両方入っています。この表がこのシステムで一番価値があります',
    irreplaceable: true,
  },
  {
    table: 'lifecycle_events',
    label: '承認・状態変更の履歴',
    why: '誰がいつ何を承認したかの記録。あとから「なぜ買ったのか」をたどれます',
    irreplaceable: true,
  },
  {
    table: 'sales_results',
    label: '販売実績',
    why: '実際に売れた個数と金額。外から買い直すことができません',
    irreplaceable: true,
  },
  {
    table: 'ad_weekly',
    label: '広告の週次実績',
    why: '広告費と売上の実績。広告AIの判断のもとになります',
    irreplaceable: true,
  },
  {
    table: 'forecast_accuracy',
    label: '予測と実績のズレ',
    why: '「予測がどれくらい当たったか」の記録。精度を上げるための土台です',
    irreplaceable: true,
  },
  {
    table: 'category_bias',
    label: 'カテゴリー別の補正値',
    why: '実績から学んだ「このカテゴリーは予測より少なめ」などの補正',
    irreplaceable: true,
  },
  {
    table: 'scoring_weights',
    label: '今つかっている重み',
    why: '商品の点数の付け方。人が承認して変えたものです',
    irreplaceable: true,
  },
  {
    table: 'score_weight_proposals',
    label: '重みの見直し案と承認の履歴',
    why: 'AIが出した案と、人が承認したかどうかの記録',
    irreplaceable: true,
  },
  {
    table: 'score_feedback',
    label: '点数への実績フィードバック',
    why: '実績にもとづく点数の修正記録',
    irreplaceable: true,
  },
  {
    table: 'research_candidates',
    label: 'リサーチ結果とランク変更の履歴',
    why: 'Research Score とランクが動いた理由（値下がりでA昇格など）が入っています',
    irreplaceable: false,
  },
  {
    table: 'research_runs',
    label: 'リサーチの実行履歴',
    why: 'いつ何件調べたかの記録',
    irreplaceable: false,
  },
  {
    table: 'lateral_seeds',
    label: '売れた商品からの横展開',
    why: '勝ちパターンの種。実績から作られたものです',
    irreplaceable: true,
  },
  {
    table: 'oem_requirements',
    label: 'OEMの改善要件',
    why: 'レビューから拾った「自社商品で直すべき点」。手で作り直すのは大変です',
    irreplaceable: true,
  },
  {
    table: 'account_health',
    label: 'アカウント健全性の記録',
    why: 'Amazonの成績の推移。過去の値はさかのぼって取れません',
    irreplaceable: true,
  },
  {
    table: 'shipment_orders',
    label: '注文と発送の記録',
    why: '出荷期限を守れたかどうかの記録',
    irreplaceable: true,
  },
  {
    table: 'supplier_price_history',
    label: '仕入先の価格の移り変わり',
    why: '仕入価格の履歴。過去の値は取り直せません',
    irreplaceable: true,
  },
  {
    table: 'supplier_listings',
    label: '仕入先の商品データ',
    why: '取り込んだ仕入先の在庫表',
    irreplaceable: false,
  },
  {
    table: 'master_images',
    label: '自社の正式画像の台帳',
    why: '権利のある画像がどれかの記録。取り違えると規約違反になります',
    irreplaceable: true,
  },
];

/** バックアップの置き場所。指定が無ければプロジェクト内の backups/ */
export function backupRoot(): string {
  return config.backupDir || path.join(PROJECT_ROOT, 'backups');
}

function stamp(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3_600_000);
  const s = jst.toISOString();
  return `${s.slice(0, 10)}_${s.slice(11, 13)}${s.slice(14, 16)}`;
}

export interface BackupResult {
  ok: boolean;
  id: string;
  dir: string | null;
  tables: { table: string; label: string; rows: number; bytes: number; error?: string }[];
  totalRows: number;
  totalBytes: number;
  dbCopied: boolean;
  removedOld: number;
  message: string;
  error?: string;
}

/**
 * バックアップを1回取る。
 * ★元のデータは読むだけ。1件も書き換えない。
 */
export async function runBackup(now = new Date()): Promise<BackupResult> {
  const id = newId('bk');
  const startedAt = nowIso();
  const t0 = Date.now();
  const dir = path.join(backupRoot(), stamp(now));

  await insert('backups', { id, status: 'RUNNING', dir, started_at: startedAt, db_copied: 0 });

  const tables: BackupResult['tables'] = [];
  let totalRows = 0;
  let totalBytes = 0;
  let dbCopied = false;

  try {
    fs.mkdirSync(dir, { recursive: true });

    for (const t of CRITICAL_TABLES) {
      try {
        const rows = await all(`SELECT * FROM ${t.table}`);
        // 1行1件のテキスト（JSONL）。表計算ソフトでもプログラムでも読み直せる形にする。
        const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
        const file = path.join(dir, `${t.table}.jsonl`);
        fs.writeFileSync(file, body, 'utf8');
        const bytes = Buffer.byteLength(body, 'utf8');
        tables.push({ table: t.table, label: t.label, rows: rows.length, bytes });
        totalRows += rows.length;
        totalBytes += bytes;
      } catch (e: any) {
        // ★1つの表で失敗しても、他の表のバックアップは続ける
        tables.push({
          table: t.table,
          label: t.label,
          rows: 0,
          bytes: 0,
          error: String(e?.message ?? e).slice(0, 200),
        });
      }
    }

    // データベースそのものの写しも置く（丸ごと戻したいとき用）
    try {
      const url = config.databaseUrl;
      if (url.startsWith('file:')) {
        const src = path.resolve(PROJECT_ROOT, url.slice('file:'.length));
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(dir, 'factory.db'));
          dbCopied = true;
        }
      }
    } catch {
      /* 写しが取れなくても、上のテキスト書き出しは残っている */
    }

    // 何が入っているかの説明書き（人が見て分かるように）
    const manifest = {
      作成日時: startedAt,
      置き場所: dir,
      データベースの写し: dbCopied ? 'あり（factory.db）' : 'なし',
      表: tables.map((t) => ({ 表の名前: t.table, 内容: t.label, 件数: t.rows, エラー: t.error ?? null })),
      戻しかた:
        'このフォルダごと安全な場所へコピーして保管してください。' +
        '戻すときは factory.db を data/ に置き換えるか、各 .jsonl を読み込み直します。' +
        '★戻す作業は必ず人の手で行ってください（自動では戻しません）。',
    };
    fs.writeFileSync(path.join(dir, 'この中身について.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const removedOld = pruneBackups(config.backupKeep);

    const failed = tables.filter((t) => t.error).length;
    const message =
      `${tables.length - failed}種類の表・合計${totalRows.toLocaleString()}件を保存しました` +
      (dbCopied ? '（データベースの写しも取りました）' : '') +
      (failed ? `／★${failed}種類は保存できませんでした` : '') +
      (removedOld ? `／古い${removedOld}世代を片づけました` : '');

    await update('backups', id, {
      status: failed ? 'PARTIAL' : 'SUCCESS',
      tables_count: tables.length - failed,
      rows_count: totalRows,
      bytes: totalBytes,
      db_copied: dbCopied ? 1 : 0,
      detail: JSON.stringify(tables),
      message,
      finished_at: nowIso(),
      duration_ms: Date.now() - t0,
    });

    return { ok: true, id, dir, tables, totalRows, totalBytes, dbCopied, removedOld, message };
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 300);
    await update('backups', id, {
      status: 'FAILED',
      error,
      message: `バックアップに失敗しました：${error}`,
      finished_at: nowIso(),
      duration_ms: Date.now() - t0,
    });
    return {
      ok: false,
      id,
      dir: null,
      tables,
      totalRows,
      totalBytes,
      dbCopied,
      removedOld: 0,
      message: `★バックアップに失敗しました：${error}`,
      error,
    };
  }
}

/**
 * 古い世代を消す。
 * ★消すのは「バックアップの写し」だけ。本体のデータには絶対にさわらない。
 */
export function pruneBackups(keep = 30): number {
  try {
    const root = backupRoot();
    if (!fs.existsSync(root)) return 0;
    const dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d.name))
      .map((d) => d.name)
      .sort();
    if (dirs.length <= keep) return 0;
    const doomed = dirs.slice(0, dirs.length - keep);
    let removed = 0;
    for (const name of doomed) {
      try {
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
        removed++;
      } catch {
        /* 消せなくても続ける */
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

export interface BackupRow {
  id: string;
  status: string;
  dir: string | null;
  tablesCount: number | null;
  rowsCount: number | null;
  bytes: number | null;
  dbCopied: boolean;
  message: string | null;
  error: string | null;
  startedAt: string;
  durationMs: number | null;
}

export async function backupList(limit = 20): Promise<BackupRow[]> {
  const rows = await all(`SELECT * FROM backups ORDER BY started_at DESC LIMIT ?`, [limit]);
  return rows.map((r: any) => ({
    id: String(r.id),
    status: String(r.status),
    dir: r.dir ? String(r.dir) : null,
    tablesCount: r.tables_count != null ? Number(r.tables_count) : null,
    rowsCount: r.rows_count != null ? Number(r.rows_count) : null,
    bytes: r.bytes != null ? Number(r.bytes) : null,
    dbCopied: Number(r.db_copied) === 1,
    message: r.message ? String(r.message) : null,
    error: r.error ? String(r.error) : null,
    startedAt: String(r.started_at),
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
  }));
}

export interface BackupStatus {
  lastAt: string | null;
  ageHours: number | null;
  ok: boolean;
  stale: boolean;
  dir: string;
  keep: number;
  intervalHours: number;
  headline: string;
  advice: string[];
}

export async function backupStatus(): Promise<BackupStatus> {
  const row = await one(
    `SELECT * FROM backups WHERE status IN ('SUCCESS','PARTIAL') ORDER BY started_at DESC LIMIT 1`,
  );
  const lastAt = row?.started_at ? String(row.started_at) : null;
  const t = lastAt ? Date.parse(lastAt) : NaN;
  const ageHours = Number.isFinite(t) ? Math.floor((Date.now() - t) / 3_600_000) : null;
  const intervalHours = config.backupIntervalHours;
  // 予定の2倍たっても取れていなければ「古い」
  const stale = ageHours == null || ageHours > intervalHours * 2;

  const advice: string[] = [];
  let headline: string;
  if (lastAt == null) {
    headline = '★大事なデータのバックアップは、まだ一度も取れていません';
    advice.push('下の「今すぐバックアップ」を1回押してください（お金はかかりません）');
  } else if (stale) {
    headline = `★バックアップが${ageHours}時間前から取れていません`;
    advice.push('自動運転が止まっている可能性があります');
  } else {
    headline = `バックアップは取れています（${ageHours}時間前）`;
  }
  advice.push(
    '★このシステムで一番価値が高いのは「自社の販売実績」です。買い直せないので、' +
      'バックアップ先を外付けディスクやクラウド同期フォルダにしておくと、パソコンが壊れても残ります（BACKUP_DIR で変更できます）',
  );

  return {
    lastAt,
    ageHours,
    ok: lastAt != null && !stale,
    stale,
    dir: backupRoot(),
    keep: config.backupKeep,
    intervalHours,
    headline,
    advice,
  };
}
