/**
 * 依存ライブラリ無しのCSVパーサ（RFC4180準拠・引用符/改行/BOM対応）。
 * 数万行を一度に扱う前提なので、行ごとに正規表現を回さず1文字ずつ走査する。
 */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    row.push(field);
    field = '';
    // 空行（カラム1個かつ空文字）は捨てる
    if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      pushRow();
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }

  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/** 列名の別名表。日本語ヘッダのCSVでもそのまま取り込めるようにする。 */
const HEADER_ALIASES: Record<string, string[]> = {
  supplier: ['supplier', 'supplier_code', '仕入先', '仕入先コード', '店舗'],
  supplier_product_id: ['supplier_product_id', 'external_id', 'id', '商品id', '商品番号', '管理番号', '在庫番号'],
  product_name: ['product_name', 'name', 'title', '商品名', 'タイトル'],
  brand: ['brand', 'maker', 'ブランド', 'メーカー'],
  category: ['category', 'category_key', 'カテゴリ', 'カテゴリー', '分類'],
  model_number: ['model_number', 'model', '型番', 'モデル', '品番'],
  jan: ['jan', 'gtin', 'ean', 'upc', 'janコード'],
  sku: ['sku', '商品コード'],
  size: ['size', 'サイズ'],
  color: ['color', 'colour', 'カラー', '色'],
  condition: ['condition', 'rank', 'grade', '状態', 'コンディション', 'ランク'],
  purchase_price: ['purchase_price', 'cost', 'price', '仕入価格', '仕入値', '価格', '販売価格_仕入先'],
  market_price: ['market_price', 'market', '市場価格', '相場', '相場価格'],
  stock: ['stock', 'quantity', 'qty', '在庫', '在庫数'],
  product_url: ['product_url', 'url', 'link', '商品url', 'リンク'],
  image_url: ['image_url', 'image', '画像', '画像url'],
  market_price_source: ['market_price_source', '相場出典', '相場ソース'],
  market_fetched_at: ['market_fetched_at', '相場取得日', '相場日時'],
};

function canon(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_\-　]/g, '');
}

/** ヘッダ行から「正規列名 → 列番号」を作る。未知の列は無視する。 */
export function mapHeaders(header: string[]): Record<string, number> {
  const lookup = new Map<string, string>();
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const a of aliases) lookup.set(canon(a), key);
  }
  const map: Record<string, number> = {};
  header.forEach((h, idx) => {
    const key = lookup.get(canon(h));
    if (key && map[key] === undefined) map[key] = idx;
  });
  return map;
}

export type RawRow = Record<string, string>;

/** CSV全体を「正規列名→値」の配列に変換する。項目が欠けていても落ちない。 */
export function readCsvRows(text: string): { rows: RawRow[]; header: string[]; mapped: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], header: [], mapped: [] };
  const header = table[0];
  const map = mapHeaders(header);
  const rows: RawRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const line = table[r];
    const obj: RawRow = {};
    for (const [key, idx] of Object.entries(map)) {
      obj[key] = (line[idx] ?? '').trim();
    }
    rows.push(obj);
  }
  return { rows, header, mapped: Object.keys(map) };
}
