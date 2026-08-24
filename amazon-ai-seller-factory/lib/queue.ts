/**
 * ジョブ実行の差し替え口。
 * 今はRedis不要の「その場で順番に実行する」方式。
 * 台数を増やしてAI社員を24時間走らせる段階になったら、
 * BullMQ など外部キューの実装をここに足して enqueue() を差し替える。
 */
export interface JobQueue {
  readonly name: string;
  enqueue(jobId: string, fn: () => Promise<void>): void;
  isRunning(jobId: string): boolean;
  runningCount(): number;
}

class InProcessQueue implements JobQueue {
  readonly name = 'in-process';
  private running = new Map<string, Promise<void>>();
  private chain: Promise<void> = Promise.resolve();

  enqueue(jobId: string, fn: () => Promise<void>): void {
    const task = this.chain.then(async () => {
      try {
        await fn();
      } catch (err) {
        console.error(`[queue] ジョブ ${jobId} が失敗:`, err);
      } finally {
        this.running.delete(jobId);
      }
    });
    this.chain = task;
    this.running.set(jobId, task);
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  runningCount(): number {
    return this.running.size;
  }
}

// 開発時のホットリロードで多重生成しないようグローバルに1つだけ持つ
const g = globalThis as unknown as { __factoryQueue?: JobQueue };
export const queue: JobQueue = g.__factoryQueue ?? (g.__factoryQueue = new InProcessQueue());
