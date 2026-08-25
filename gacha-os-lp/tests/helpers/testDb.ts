/**
 * 試験用のDBを用意する。
 *
 * ★試験が本番のDBに触れないようにすること。
 *   同時抽選の試験は1000回ぶんのポイントを動かします。
 *   接続先を間違えると、本番のお客様の残高が動きます。
 *
 *   そこで、このファイルを読み込んだ時点で接続先を
 *   使い捨ての一時ファイルに固定します。
 *   環境変数に本番のURLが入っていても、必ず上書きします。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "gacha-os-test-"));

process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
process.env.DATABASE_ENV = "test";
delete process.env.DATABASE_AUTH_TOKEN;

/** 試験用DBの置き場所（後片付けのために出しておく） */
export const TEST_DB_DIR = dir;

/**
 * 後片付けについて。
 *
 * ★終了時（process.on("exit")）にフォルダごと消さないこと。
 *   DBの接続はまだファイルを開いたままなので、
 *   開いている最中に土台を消すことになり、
 *   後片付けの最中に異常終了します（SIGSEGV）。
 *
 *   そうなると、中の試験は全部通っているのに、
 *   まとめだけが「失敗」と出ます。
 *   原因が試験の中身に見えるので、いちばん時間を取られる壊れ方です。
 *
 *   一時フォルダは、OSが後で回収します。数百KBなので放っておきます。
 *   どうしても消したいときは、接続を閉じてから消してください。
 */
export function removeTestDbDir(): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 消せなくても試験の結果には関わらない */
  }
}
