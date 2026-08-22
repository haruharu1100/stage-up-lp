import fs from 'node:fs';
import path from 'node:path';

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, 'data');

// ワークスペース内の既存プロジェクトから鍵を借りる（検証コスト削減。既存OSと同じ作法）
const FALLBACK_ENV_FILES = [
  path.join(ROOT, '.env'),
  path.join(ROOT, '..', 'ai-commerce-os', '.env'),
  path.join(ROOT, '..', 'lp-ai-orchestrator', '.env'),
  path.join(ROOT, '..', 'aura', '.env'),
  // 日本語調査で使う検索系の鍵は、既にこれらのプロジェクトが持っている場合がある
  path.join(ROOT, '..', 'gorogoro-growth', '.env'),
  path.join(ROOT, '..', 'zunda_video', '.env'),
  path.join(ROOT, '..', 'youtube_shorts', '.env'),
  path.join(ROOT, '..', 'trivia-channel', '.env'),
];

function loadEnvFiles() {
  for (const file of FALLBACK_ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
}
loadEnvFiles();

/**
 * 外部に副作用を出す行為はすべて既定 false。
 * env を true にしても、下の MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED = false のとおり
 * このリポジトリには送信・課金・架電を実行するコードが存在しない（二重ロック）。
 */
export const config = {
  databaseUrl: process.env.DATABASE_URL || `file:${path.join(DATA_DIR, 'business.db')}`,

  autoMode: process.env.BUSINESS_AUTO_MODE || 'SAFE',

  // 調査・計算のみ = お金も外部送信も発生しないので true でよい
  autoResearch: bool(process.env.AUTO_RESEARCH, true),
  autoBacktest: bool(process.env.AUTO_BACKTEST, true),

  // 外部副作用 = 常に false 既定。人間承認が必須
  autoPublish: bool(process.env.AUTO_PUBLISH, false),
  autoCall: bool(process.env.AUTO_CALL, false),
  autoEmail: bool(process.env.AUTO_EMAIL, false),
  autoDm: bool(process.env.AUTO_DM, false),
  autoCharge: bool(process.env.AUTO_CHARGE, false),

  aiEnabled: bool(process.env.AI_ENABLED, false),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  githubToken: process.env.GITHUB_TOKEN || '',
  productHuntToken: process.env.PRODUCT_HUNT_TOKEN || '',

  // 日本語市場調査用。鍵が無いチャネルは 0件ではなく UNAVAILABLE として記録する
  // 鍵そのものはコードにもGitにも置かない。.env から読むだけ
  googleCseKey:
    process.env.GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_API_KEY || '',
  googleCseCx:
    process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_CX || process.env.GOOGLE_CSE_ID || '',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || '',

  // 無料枠を浪費しないための上限。1日あたりの検索回数と、1案件あたりの検索語数
  googleSearchDailyLimit: num(process.env.GOOGLE_SEARCH_DAILY_LIMIT, 100),
  googleSearchPerIdea: num(process.env.GOOGLE_SEARCH_PER_IDEA, 4),

  // 判定しきい値（コードで計算する。AIに決めさせない）
  minLtvCacRatio: num(process.env.MIN_LTV_CAC_RATIO, 3),
  minSampleSize: num(process.env.MIN_SAMPLE_SIZE, 30),
  monteCarloRuns: num(process.env.MONTE_CARLO_RUNS, 2000),

  obsidianVault:
    process.env.OBSIDIAN_VAULT ||
    path.join(ROOT, '..', '事業Vault'),
} as const;

/** 送金・架電・送信・公開を実行するコードは本リポジトリに存在しない。 */
export const MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED = false;

/** 外部副作用フラグの一覧（受入テストと画面表示で使う） */
export const OUTBOUND_FLAGS = {
  AUTO_PUBLISH: config.autoPublish,
  AUTO_CALL: config.autoCall,
  AUTO_EMAIL: config.autoEmail,
  AUTO_DM: config.autoDm,
  AUTO_CHARGE: config.autoCharge,
} as const;

export function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
