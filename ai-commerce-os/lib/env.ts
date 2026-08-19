import path from 'node:path';

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export const DATA_DIR = path.join(process.cwd(), 'data');

export const config = {
  databaseUrl: process.env.DATABASE_URL || 'file:data/commerce.db',

  autoMode: process.env.COMMERCE_AUTO_MODE || 'SAFE',
  sandbox: bool(process.env.SANDBOX, true),
  shadowMode: bool(process.env.SHADOW_MODE, true),

  autoResearch: bool(process.env.AUTO_RESEARCH, true),
  autoBuy: bool(process.env.AUTO_BUY, false),
  autoListing: bool(process.env.AUTO_LISTING, false),
  autoReprice: bool(process.env.AUTO_REPRICE, false),
  autoOrderProcessing: bool(process.env.AUTO_ORDER_PROCESSING, false),
  autoReorder: bool(process.env.AUTO_REORDER, false),

  aiEnabled: bool(process.env.AI_ENABLED, false),
} as const;

/**
 * Phase 1 は金銭を動かす処理を一切持たない。
 * 将来 Action Gate を実装するまで、実行系の env が true でも動かないことをここで宣言しておく。
 */
export const PHASE = 1;
export const MONEY_ACTIONS_IMPLEMENTED = false;
