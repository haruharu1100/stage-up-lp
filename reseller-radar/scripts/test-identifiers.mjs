// JAN・型番抽出エンジンの単体テスト
// 実行: node --test scripts/test-identifiers.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractIdentifiers,
  isValidJan13,
  isValidJan8,
  bestValue,
  hasJanConflict,
} from "../lib/identifiers.mjs";

test("JAN13 チェックディジット", () => {
  assert.equal(isValidJan13("4901234567894"), true);
  assert.equal(isValidJan13("4901234567890"), false);
});

test("JSON-LD から gtin13 / mpn / brand を抽出（最優先）", () => {
  const html = `<html><head>
    <script type="application/ld+json">
    {"@type":"Product","name":"テスト","gtin13":"4901234567894","mpn":"SPF-040U","brand":{"name":"HORI"}}
    </script></head><body></body></html>`;
  const r = extractIdentifiers(html);
  assert.equal(bestValue(r.jan), "4901234567894");
  assert.equal(r.jan[0].source, "structured");
  assert.equal(bestValue(r.model), "SPF-040U");
  assert.equal(bestValue(r.brand), "HORI");
});

test("microdata itemprop=gtin13 を抽出", () => {
  const html = `<div itemscope><span itemprop="gtin13">4901234567894</span>
    <meta itemprop="mpn" content="ABC-123"></div>`;
  const r = extractIdentifiers(html);
  assert.equal(bestValue(r.jan), "4901234567894");
  assert.equal(bestValue(r.model), "ABC-123");
});

test("スペック表（th/td）ラベルから JAN・型番を抽出", () => {
  const html = `<table>
    <tr><th>JANコード</th><td>4901234567894</td></tr>
    <tr><th>型番</th><td>SDSQXAV-256G</td></tr>
    </table>`;
  const r = extractIdentifiers(html);
  assert.equal(bestValue(r.jan), "4901234567894");
  assert.equal(bestValue(r.model), "SDSQXAV-256G");
});

test("本文フォールバック：ラベル付きJAN", () => {
  const r = extractIdentifiers("", "商品説明 JANコード: 4901234567894 です");
  assert.equal(bestValue(r.jan), "4901234567894");
});

test("構造化データは本文より優先される", () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@type":"Product","gtin13":"4901234567894"}</script>
    </head><body>4988755123456</body></html>`;
  const r = extractIdentifiers(html);
  // 構造化(0.98) が本文(0.4) より上位
  assert.equal(r.jan[0].value, "4901234567894");
  assert.equal(r.jan[0].source, "structured");
});

test("JAN候補が食い違えば hasJanConflict=true", () => {
  const html = `<script type="application/ld+json">{"@type":"Product","gtin13":"4901234567894"}</script>`;
  const r = extractIdentifiers(html, "別のコード 4988755123457");
  assert.equal(hasJanConflict(r.jan), true);
});

test("不正なJAN(チェックディジット不一致)は候補にしない", () => {
  const r = extractIdentifiers("", "1234567890123");
  assert.equal(r.jan.length, 0);
});
