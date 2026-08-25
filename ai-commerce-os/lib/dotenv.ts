/**
 * `.env` を読み込む（コマンド実行用）。
 *
 * 画面（Next.js）は `.env` を自分で読むが、`npm run ...` で動かすコマンドは読まない。
 * そのための最小限の読み取り。**外部ライブラリは足さない。**
 *
 * ------------------------------------------------------------------
 * 【値を絶対に出さない】
 *
 * この関数は「読み込んだ変数の名前」しか返さない。値は返さないし、出力もしない。
 * デバッグのつもりで値を出力する行を、ここにもどこにも書かない。
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * `.env` を読んで `process.env` に入れる。
 * すでに設定済みの変数は**上書きしない**（コマンドラインで渡した値の方を優先する）。
 *
 * @returns 読み込めた変数の**名前だけ**の一覧
 */
export function loadDotEnv(file = '.env'): string[] {
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) return [];

  const names: string[] = [];
  const text = fs.readFileSync(abs, 'utf8');

  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;

    const name = t.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;

    let value = t.slice(eq + 1).trim();
    // 前後のクォートだけ外す。中身には一切手を触れない。
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    names.push(name);
    if (process.env[name] === undefined) process.env[name] = value;
  }

  return names;
}
