import fs from 'node:fs';
import path from 'node:path';

/**
 * .env を読む。
 * Next.js は自分で読むが、tsx で動かすスクリプトは読まないので、ここで補う。
 * すでに設定済みの環境変数は上書きしない。値はどこにも出力しない。
 */
function loadDotEnv(): void {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
loadDotEnv();

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** 秘密の値は「あるか無いか」だけを外へ出す。値そのものは返さない。 */
export function hasSecret(name: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'HOUJIN_BANGOU_APP_ID' | 'GBIZINFO_API_TOKEN' | 'GOOGLE_PLACES_API_KEY'): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

/** 呼び出し直前にだけ取り出す。ログにも画面にも出さない。 */
export function secret(name: string): string | null {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export const DATA_DIR = path.join(process.cwd(), 'data');

export const config = {
  get databaseUrl() {
    return str('DATABASE_URL', 'file:data/sales.db');
  },
  get obsidianVaultDir() {
    return str('OBSIDIAN_VAULT_DIR', '/Volumes/ORICO/保存用/hp用/hp-auto-system/事業Vault');
  },
  get obsidianMemoryDir() {
    return str('OBSIDIAN_MEMORY_DIR', '/Users/yokotaakiraju/Documents/Obsidian Vault/_AI/memory');
  },

  get aiEnabled() {
    return bool('AI_ENABLED', false);
  },
  get openaiModel() {
    return str('OPENAI_MODEL', 'gpt-5.6-sol');
  },

  // 調査・解析・生成・採点はここまで自動でよい
  get autoResearch() {
    return bool('AUTO_RESEARCH', true);
  },

  // ---- 外部に影響が出る操作。初期値はすべて false ----
  get autoCall() {
    return bool('AUTO_CALL', false);
  },
  get autoEmail() {
    return bool('AUTO_EMAIL', false);
  },
  get autoForm() {
    return bool('AUTO_FORM', false);
  },
  get autoApply() {
    return bool('AUTO_APPLY', false);
  },
  get autoDeliver() {
    return bool('AUTO_DELIVER', false);
  },

  get releasePhase() {
    return num('RELEASE_PHASE', 1);
  },
} as const;

/**
 * 外部に影響が出る操作は「フラグを false にしている」だけではなく、
 * 実行する処理コードそのものを置いていない。
 * ここを true に書き換えても送信は起きない（送信関数が存在しない）。
 */
export const EXTERNAL_ACTIONS_IMPLEMENTED = false as const;

export type ExternalAction = 'CALL' | 'EMAIL' | 'FORM' | 'APPLY' | 'DELIVER';

export const EXTERNAL_ACTION_LABEL: Record<ExternalAction, string> = {
  CALL: 'AI電話をかける',
  EMAIL: '営業メールを送る',
  FORM: '問い合わせフォームを送信する',
  APPLY: '案件に応募する',
  DELIVER: '成果物を納品する',
};

export function externalFlag(action: ExternalAction): boolean {
  switch (action) {
    case 'CALL':
      return config.autoCall;
    case 'EMAIL':
      return config.autoEmail;
    case 'FORM':
      return config.autoForm;
    case 'APPLY':
      return config.autoApply;
    case 'DELIVER':
      return config.autoDeliver;
  }
}
