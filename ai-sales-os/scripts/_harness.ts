/**
 * テストの土台。外部のテスト用ライブラリは入れない（依存を増やさないため）。
 * 使い方は test-safety.ts / test-sales.ts / test-jobs.ts を参照。
 */

export type Case = { name: string; ok: boolean; detail: string };

export class Suite {
  readonly title: string;
  readonly cases: Case[] = [];

  constructor(title: string) {
    this.title = title;
  }

  /** 条件を1つ確かめる。detail には「実際どうだったか」を必ず書く。 */
  check(name: string, ok: boolean, detail: string): void {
    this.cases.push({ name, ok, detail });
  }

  eq(name: string, actual: unknown, expected: unknown, unit = ''): void {
    this.check(name, Object.is(actual, expected), `実際: ${String(actual)}${unit} / 期待: ${String(expected)}${unit}`);
  }

  atLeast(name: string, actual: number, min: number, unit = ''): void {
    this.check(name, actual >= min, `実際: ${actual}${unit} / ${min}${unit}以上であること`);
  }

  atMost(name: string, actual: number, max: number, unit = ''): void {
    this.check(name, actual <= max, `実際: ${actual}${unit} / ${max}${unit}以下であること`);
  }

  get passed(): number {
    return this.cases.filter((c) => c.ok).length;
  }

  get failed(): number {
    return this.cases.length - this.passed;
  }

  print(): void {
    console.log(`■ ${this.title}`);
    for (const c of this.cases) {
      console.log(`  ${c.ok ? '合格' : '不合格'} … ${c.name}`);
      if (!c.ok) console.log(`         ${c.detail}`);
    }
    console.log(`  → ${this.passed}件合格 / ${this.failed}件不合格`);
    console.log('');
  }
}

/** 何件か落ちたら 1 で終わる。CIでも人でも同じ判断ができるようにする。 */
export function finish(suites: Suite[]): void {
  const passed = suites.reduce((n, s) => n + s.passed, 0);
  const failed = suites.reduce((n, s) => n + s.failed, 0);
  console.log('================================');
  console.log(`合計: ${passed}件合格 / ${failed}件不合格`);
  if (failed > 0) {
    console.log('不合格があります。直すまで次に進みません。');
    process.exit(1);
  }
  console.log('すべて合格です。');
}
