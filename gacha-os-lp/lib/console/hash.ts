/**
 * SHA-256（同期版）。
 *
 * ★なぜ自前で持っているのか
 *   ブラウザにも Node にも SHA-256 は入っていますが、どちらも「待つ」形
 *   （async）でしか呼べません。監査ログのハッシュチェーンは
 *   「1件足すたびに、前の1件のハッシュを混ぜて次を作る」という直列の処理なので、
 *   途中で待ちが入ると、画面の状態を更新する処理（reducer）の中で使えません。
 *   reducer は同期でなければならないので、ここだけ同期版を持ちます。
 *
 * ★これは飾りではありません。
 *   AUDIT VERIFY（監査ログの検証）が「本当に改ざんを見つけられる」ことが、
 *   この管理画面で見せたいことの中心です。
 *   適当なハッシュ（文字コードを足すだけ、など）にすると、
 *   中身を書き換えても同じ値になってしまう組み合わせが簡単に作れて、
 *   「検証しています」と言いながら実際には何も検証していない状態になります。
 *   それは、このシステムで最もやってはいけないことです。
 *
 * ★実装は FIPS 180-4 の通りです。
 *   短く書くために変数名を仕様書に合わせています（h0..h7, k, w など）。
 *   読みやすさより、仕様と1対1で照らし合わせられることを優先しています。
 *   ここを「きれいに」書き直さないこと。ハッシュは1ビット違えば別物になるので、
 *   見た目を整える書き換えで壊れても、動かしてみるまで気づけません。
 *   tests/consoleAudit.test.ts に、正解が分かっている入力での期待値を置いてあります。
 */

/** FIPS 180-4 で定義されている定数（最初の64個の素数の立方根の小数部） */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 右回転。JavaScript には無いので自分で作る */
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/**
 * 文字列を UTF-8 のバイト列にする。
 *
 * ★TextEncoder を使わない理由
 *   古いブラウザや一部の実行環境で存在しないことがあり、
 *   そこだけ監査ログが作れなくなると、原因が分かりにくい壊れ方をします。
 *   日本語（3バイト）と絵文字（4バイト・サロゲートペア）も通るようにしてあります。
 */
function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      /* サロゲートペア（絵文字など）。2つで1文字なので、まとめて4バイトにする */
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = ((c - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i++;
        out.push(
          0xf0 | (c >> 18),
          0x80 | ((c >> 12) & 0x3f),
          0x80 | ((c >> 6) & 0x3f),
          0x80 | (c & 0x3f),
        );
        continue;
      }
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

/**
 * 文字列の SHA-256 を、16進64文字で返す。
 *
 * 使い方:
 *   sha256("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
 */
export function sha256(message: string): string {
  const bytes = utf8Bytes(message);
  const bitLen = bytes.length * 8;

  /* 末尾に 1ビットの 1 を足し、長さ(64bit)を入れる場所を残して 0 で埋める */
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);

  /* 元の長さを 64bit ビッグエンディアンで足す。
     上位32bitは、この用途（監査ログ1件分の文字列）では常に0だが仕様通り書く */
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push(
    (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff,
  );

  /* 初期値（最初の8個の素数の平方根の小数部） */
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (bytes[off + i * 4] << 24) |
        (bytes[off + i * 4 + 1] << 16) |
        (bytes[off + i * 4 + 2] << 8) |
        bytes[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => x.toString(16).padStart(8, "0"))
    .join("");
}
