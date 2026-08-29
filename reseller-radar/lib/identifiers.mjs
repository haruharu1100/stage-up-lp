// ─────────────────────────────────────────────────────────────
// JAN・型番 抽出エンジン（構造化データ優先・純粋関数）
//
// 目的：仕入れ元ページから「確実な JAN / 型番」をできる限り拾う。
// 方針：信頼度の高い順に候補を集め、複数候補が食い違えば conflict を立てる。
//   優先順位：
//     1. 構造化データ  JSON-LD (gtin / gtin13 / gtin14 / gtin12 / gtin8 / mpn / sku / model / brand)
//     2. microdata / meta (itemprop=gtin13 / mpn / sku / model, meta[property])
//     3. スペック表・定義リスト（「JANコード」「型番」等のラベル）
//     4. タイトル
//     5. 本文の正規表現フォールバック
//
// 返り値はすべて {value, source, confidence} の候補配列で保持する。
// 値をでっち上げない。取得できなければ空配列。
// cheerio に依存（DB/通信には依存しない）。
// ─────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";

// JAN(EAN13) チェックディジット検証
export function isValidJan13(code) {
  const s = String(code || "").replace(/\D/g, "");
  if (s.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = s.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? n : n * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === s.charCodeAt(12) - 48;
}

// 8桁(EAN8) チェックディジット検証
export function isValidJan8(code) {
  const s = String(code || "").replace(/\D/g, "");
  if (s.length !== 8) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const n = s.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? n * 3 : n;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === s.charCodeAt(7) - 48;
}

// GTIN14 / UPC12 → JAN13 への寄せ（先頭0を落とす等）
function toJan13(raw) {
  let s = String(raw || "").replace(/\D/g, "");
  if (s.length === 14 && s[0] === "0") s = s.slice(1); // GTIN14 の先頭パディング
  if (s.length === 12) s = "0" + s; // UPC-A → EAN13
  return s;
}

const CONF = { structured: 0.98, microdata: 0.95, spec: 0.85, title: 0.6, body: 0.4 };

function pushJan(cands, rawValue, source) {
  const j = toJan13(rawValue);
  if (j.length === 13 && isValidJan13(j)) {
    cands.push({ value: j, source, confidence: CONF[source] ?? 0.4 });
    return;
  }
  const s8 = String(rawValue || "").replace(/\D/g, "");
  if (s8.length === 8 && isValidJan8(s8)) {
    cands.push({ value: s8, source, confidence: (CONF[source] ?? 0.4) - 0.05 });
  }
}

function pushModel(cands, rawValue, source) {
  const v = String(rawValue || "").trim();
  if (!v) return;
  // 明らかに型番でない長文（空白多数・50文字超）は除外
  if (v.length > 50 || (v.match(/\s/g) || []).length > 4) return;
  cands.push({ value: v, source, confidence: CONF[source] ?? 0.4 });
}

// JSON-LD を全て走査して Product ノードを集める
function collectJsonLd($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        stack.push(...n);
        continue;
      }
      if (n["@graph"]) stack.push(...[].concat(n["@graph"]));
      nodes.push(n);
    }
  });
  return nodes;
}

function brandName(b) {
  if (!b) return null;
  if (typeof b === "string") return b;
  if (typeof b === "object") return b.name || null;
  return null;
}

// メイン：HTML と（任意で）プレーンテキストから JAN/型番/ブランド候補を抽出
export function extractIdentifiers(html, text = "") {
  const janCands = [];
  const modelCands = [];
  const brandCands = [];

  let $ = null;
  try {
    $ = cheerio.load(html || "");
  } catch {
    $ = null;
  }

  if ($) {
    // 1. JSON-LD 構造化データ
    for (const node of collectJsonLd($)) {
      const gtinKeys = ["gtin13", "gtin14", "gtin12", "gtin8", "gtin", "ean", "ean13"];
      for (const k of gtinKeys) {
        if (node[k] != null) pushJan(janCands, node[k], "structured");
      }
      if (node.mpn != null) pushModel(modelCands, node.mpn, "structured");
      if (node.model != null) pushModel(modelCands, node.model, "structured");
      if (node.sku != null) pushModel(modelCands, node.sku, "structured");
      const bn = brandName(node.brand);
      if (bn) brandCands.push({ value: String(bn), source: "structured", confidence: CONF.structured });
      // offers 内の gtin
      const offers = [].concat(node.offers || []);
      for (const of of offers) {
        if (of && typeof of === "object") {
          for (const k of gtinKeys) if (of[k] != null) pushJan(janCands, of[k], "structured");
          if (of.sku != null) pushModel(modelCands, of.sku, "structured");
        }
      }
    }

    // 2. microdata / meta
    $("[itemprop]").each((_, el) => {
      const prop = String($(el).attr("itemprop") || "").toLowerCase();
      const content = $(el).attr("content") || $(el).text();
      if (!content) return;
      if (/gtin(13|14|12|8)?$|^ean$/.test(prop)) pushJan(janCands, content, "microdata");
      else if (prop === "mpn") pushModel(modelCands, content, "microdata");
      else if (prop === "sku") pushModel(modelCands, content, "microdata");
      else if (prop === "model") pushModel(modelCands, content, "microdata");
      else if (prop === "brand") brandCands.push({ value: String(content).trim(), source: "microdata", confidence: CONF.microdata });
    });
    $('meta[property], meta[name]').each((_, el) => {
      const prop = String($(el).attr("property") || $(el).attr("name") || "").toLowerCase();
      const content = $(el).attr("content");
      if (!content) return;
      if (/gtin13|:ean|product:ean/.test(prop)) pushJan(janCands, content, "microdata");
      else if (/mpn|product:mfr_part_no/.test(prop)) pushModel(modelCands, content, "microdata");
      else if (/product:brand|og:brand/.test(prop)) brandCands.push({ value: String(content).trim(), source: "microdata", confidence: CONF.microdata });
    });

    // 3. スペック表・定義リスト（ラベル→値）
    $("tr, dl > div, li").each((_, el) => {
      const $el = $(el);
      let label = "";
      let value = "";
      const th = $el.find("th").first();
      const td = $el.find("td").first();
      const dt = $el.find("dt").first();
      const dd = $el.find("dd").first();
      if (th.length && td.length) {
        label = th.text();
        value = td.text();
      } else if (dt.length && dd.length) {
        label = dt.text();
        value = dd.text();
      } else {
        return;
      }
      label = label.replace(/\s+/g, "");
      value = value.trim();
      if (!value) return;
      if (/(jan|ean|バーコード|ＪＡＮ)/i.test(label)) pushJan(janCands, value, "spec");
      else if (/(型番|品番|モデル番号|メーカー品番|商品型番|model)/i.test(label)) pushModel(modelCands, value, "spec");
      else if (/(ブランド|メーカー|brand)/i.test(label)) brandCands.push({ value, source: "spec", confidence: CONF.spec });
    });
  }

  // 4–5. タイトル & 本文フォールバック（構造化で拾えなかった時の保険）
  const plain = text || ($ ? $("title").text() + " " + $("body").text() : "");
  // ラベル付き JAN（本文中「JANコード: 4901234567894」など）
  for (const m of plain.matchAll(/(?:jan|ean|ＪＡＮ)\s*(?:コード|code)?\s*[:：]?\s*([0-9\-]{8,17})/gi)) {
    pushJan(janCands, m[1], "spec");
  }
  // 素の13桁（4/45/49始まりを優先）
  for (const m of plain.matchAll(/\b(4[59]\d{11})\b/g)) pushJan(janCands, m[1], "body");
  for (const m of plain.matchAll(/\b(\d{13})\b/g)) pushJan(janCands, m[1], "body");
  // ラベル付き型番
  for (const m of plain.matchAll(/(?:型番|品番|モデル番号|model)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-_.]{3,})/gi)) {
    pushModel(modelCands, m[1], "spec");
  }

  return {
    jan: dedupeByValue(janCands),
    model: dedupeByValue(modelCands),
    brand: dedupeByValue(brandCands),
  };
}

function dedupeByValue(cands) {
  const best = new Map();
  for (const c of cands) {
    const key = String(c.value).toLowerCase();
    const prev = best.get(key);
    if (!prev || c.confidence > prev.confidence) best.set(key, c);
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}

// 候補配列から採用する1値を選ぶ（最上位）。無ければ null。
export function bestValue(cands) {
  return cands && cands.length ? cands[0].value : null;
}

// JAN 候補が複数の“異なる値”を含み矛盾しているか
export function hasJanConflict(janCands) {
  const distinct = new Set((janCands || []).map((c) => c.value));
  return distinct.size > 1;
}
