import { insert, newId, nowIso, run, update } from './db/client';
import type { AgentId, AgentStatus, Stage } from './types';

/** AI社員の作業記録。管理画面の「AI社員ステータス」はこの2表を見ている */
export class RunLogger {
  constructor(private runId: string, private productId: string | null = null) {}

  setProduct(productId: string) {
    this.productId = productId;
  }

  async log(agent: AgentId | 'system', level: 'info' | 'warn' | 'error', message: string, detail?: unknown) {
    await insert('ai_agent_logs', {
      id: newId('log'),
      run_id: this.runId,
      product_id: this.productId,
      agent,
      level,
      message,
      detail: detail === undefined ? null : JSON.stringify(detail),
      created_at: nowIso(),
    });
  }

  async usage(agent: AgentId, provider: string, tokensIn?: number, tokensOut?: number, durationMs?: number) {
    await insert('ai_agent_logs', {
      id: newId('log'),
      run_id: this.runId,
      product_id: this.productId,
      agent,
      level: 'info',
      message: `${provider} を使用`,
      provider,
      tokens_in: tokensIn ?? null,
      tokens_out: tokensOut ?? null,
      duration_ms: durationMs ?? null,
      created_at: nowIso(),
    });
  }

  /** 1工程を実行しつつ、開始/終了/失敗を run_steps に書く */
  async step<T>(agent: AgentId, stage: Stage, fn: () => Promise<T>): Promise<T> {
    const id = newId('step');
    const startedAt = Date.now();
    await insert('run_steps', {
      id,
      run_id: this.runId,
      agent,
      stage,
      status: 'working' satisfies AgentStatus,
      started_at: nowIso(),
    });
    await run(`UPDATE runs SET stage = ? WHERE id = ?`, [stage, this.runId]);
    try {
      const result = await fn();
      await update('run_steps', id, {
        status: 'done',
        finished_at: nowIso(),
        duration_ms: Date.now() - startedAt,
      });
      return result;
    } catch (err: any) {
      const message = err?.message || String(err);
      await update('run_steps', id, {
        status: 'error',
        note: message,
        finished_at: nowIso(),
        duration_ms: Date.now() - startedAt,
      });
      await this.log(agent, 'error', message, { stack: err?.stack });
      throw err;
    }
  }

  /** 完了はしたが人の確認が要る時 */
  async needsReview(agent: AgentId, stage: Stage, note: string) {
    await insert('run_steps', {
      id: newId('step'),
      run_id: this.runId,
      agent,
      stage,
      status: 'needs_review' satisfies AgentStatus,
      note,
      started_at: nowIso(),
      finished_at: nowIso(),
      duration_ms: 0,
    });
    await this.log(agent, 'warn', note);
  }
}
