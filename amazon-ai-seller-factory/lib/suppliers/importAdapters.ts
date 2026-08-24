import fs from 'node:fs';
import { config } from '../env';
import { supplierListingCsvPath } from '../providers/supplier';

/**
 * 仕入先データの取込アダプタ。
 *
 * ユーザー指定：
 *   「Supplier Import を強化してください。将来的に
 *     CSV / Google Sheets / メール添付CSV・XLSX / API / SFTP / 共有URL
 *     を追加できるようにしてください。」
 *
 * ★アダプタは「CSVの文字列を返す」ことだけに責任を持つ。
 *   取り込んだ後の差分判定は supplierImport.ts が共通で行うので、
 *   新しい入口を足すときはここに1クラス書くだけで済む。
 * ★実装していない入口は「できます」と嘘をつかず、理由を返して止まる。
 */

export interface ImportAdapter {
  readonly name: string;
  /** 今すぐ使えるか（鍵やファイルがそろっているか） */
  readonly ready: boolean;
  /** 画面に出す説明。使えない時は「何を用意すれば使えるか」を書く */
  readonly note: string;
  /** どこから取ったか（履歴に残す） */
  readonly sourceRef: string;
  /** CSV文字列を返す。取れなければ null */
  fetchCsv(): Promise<string | null>;
}

// ---- ① ローカルCSV（今すぐ使える）------------------------------------

class LocalCsvAdapter implements ImportAdapter {
  readonly name = 'csv';
  get ready() {
    return fs.existsSync(supplierListingCsvPath());
  }
  get note() {
    return this.ready
      ? `${supplierListingCsvPath()} を読み込みます`
      : `${supplierListingCsvPath()} にCSVを置くと使えます（見本：samples/supplier_listings.csv）`;
  }
  get sourceRef() {
    return supplierListingCsvPath();
  }
  async fetchCsv() {
    if (!this.ready) return null;
    return fs.readFileSync(supplierListingCsvPath(), 'utf8');
  }
}

// ---- ② Google スプレッドシート（CSV公開URL）---------------------------

class SheetsAdapter implements ImportAdapter {
  readonly name = 'sheets';
  private url = config.supplierSheetUrl;
  get ready() {
    return !!this.url;
  }
  get note() {
    return this.ready
      ? 'Googleスプレッドシートから読み込みます'
      : 'SUPPLIER_SHEET_URL に「ウェブに公開 → CSV」のURLを入れると使えます';
  }
  get sourceRef() {
    return this.url || '(未設定)';
  }
  async fetchCsv() {
    if (!this.ready) return null;
    const res = await fetch(this.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`スプレッドシートの取得に失敗しました（${res.status}）`);
    return res.text();
  }
}

// ---- ③ 共有URL（仕入先がCSVを置いている場所）--------------------------

class UrlAdapter implements ImportAdapter {
  readonly name = 'url';
  private url = config.supplierCsvUrl;
  get ready() {
    return !!this.url;
  }
  get note() {
    return this.ready ? '共有URLのCSVを読み込みます' : 'SUPPLIER_CSV_URL にCSVの場所を入れると使えます';
  }
  get sourceRef() {
    return this.url || '(未設定)';
  }
  async fetchCsv() {
    if (!this.ready) return null;
    const res = await fetch(this.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`CSVの取得に失敗しました（${res.status}）`);
    return res.text();
  }
}

// ---- ④⑤⑥ まだ受け口だけ（メール添付・API・SFTP）-----------------------

class NotReadyAdapter implements ImportAdapter {
  readonly ready = false;
  constructor(
    readonly name: string,
    readonly note: string,
  ) {}
  get sourceRef() {
    return '(未接続)';
  }
  async fetchCsv() {
    return null;
  }
}

const NOT_READY: ImportAdapter[] = [
  new NotReadyAdapter(
    'email',
    'メール添付のCSV・XLSX取込。受け口だけ用意しています（IMAPの接続情報をいただければつなげます）',
  ),
  new NotReadyAdapter(
    'api',
    '仕入先の正規API取込。受け口だけ用意しています（ALIBABA_* / ALI1688_* / ALIEXPRESS_* の鍵が必要です）',
  ),
  new NotReadyAdapter('sftp', 'SFTPからの定期取込。受け口だけ用意しています（接続先とパスワードが必要です）'),
];

/** 設定で有効にしたアダプタを、使える順に返す */
export function getImportAdapters(): ImportAdapter[] {
  const want = config.supplierImportAdapters
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const all: ImportAdapter[] = [new LocalCsvAdapter(), new SheetsAdapter(), new UrlAdapter(), ...NOT_READY];
  if (want.includes('auto') || !want.length) return all;
  return all.filter((a) => want.includes(a.name));
}

/** 画面用：どの入口が今つながっているか */
export function adapterStatus(): { name: string; ready: boolean; note: string }[] {
  const all: ImportAdapter[] = [new LocalCsvAdapter(), new SheetsAdapter(), new UrlAdapter(), ...NOT_READY];
  return all.map((a) => ({ name: a.name, ready: a.ready, note: a.note }));
}
