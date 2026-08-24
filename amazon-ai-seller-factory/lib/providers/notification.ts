import { insert, nowIso, newId, all } from '../db/client';
import { secret, str } from '../env';

/**
 * NotificationProvider — 「あとからLINE等を接続できる」通知の口。
 *
 * 既定は DB に貯めるだけ（管理画面のお知らせ欄に出る）。
 * LINE_NOTIFY_TOKEN や SLACK_WEBHOOK_URL を入れた瞬間に、そちらへも飛ぶ。
 */

export interface NotificationInput {
  kind:
    | 'daily_summary'
    | 'grade_promoted'
    | 'price_drop'
    | 'error'
    | 'oem'
    | 'ship_deadline'
    | 'account_health';
  title: string;
  body: string;
}

export interface NotificationProvider {
  readonly name: string;
  readonly isReal: boolean;
  readonly note: string;
  send(input: NotificationInput): Promise<{ delivered: boolean; error?: string }>;
}

class DbOnlyNotificationProvider implements NotificationProvider {
  readonly name = 'inbox';
  readonly isReal = false;
  readonly note = '管理画面のお知らせ欄にためるだけ（LINE/Slackの鍵を入れると外部にも飛びます）';
  async send() {
    return { delivered: false };
  }
}

class LineNotificationProvider implements NotificationProvider {
  readonly name = 'line';
  readonly isReal = true;
  readonly note = 'LINE Notify へ送信します';
  constructor(private token: string) {}
  async send(input: NotificationInput) {
    try {
      const res = await fetch('https://notify-api.line.me/api/notify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ message: `\n${input.title}\n${input.body}`.slice(0, 900) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return { delivered: false, error: `LINE ${res.status}` };
      return { delivered: true };
    } catch (e: any) {
      return { delivered: false, error: String(e?.message ?? e).slice(0, 120) };
    }
  }
}

class SlackNotificationProvider implements NotificationProvider {
  readonly name = 'slack';
  readonly isReal = true;
  readonly note = 'Slack Incoming Webhook へ送信します';
  constructor(private url: string) {}
  async send(input: NotificationInput) {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `*${input.title}*\n${input.body}`.slice(0, 3000) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return { delivered: false, error: `Slack ${res.status}` };
      return { delivered: true };
    } catch (e: any) {
      return { delivered: false, error: String(e?.message ?? e).slice(0, 120) };
    }
  }
}

export function getNotificationProvider(): NotificationProvider {
  const want = str('NOTIFY_PROVIDER', 'auto');
  if (want === 'none' || want === 'inbox') return new DbOnlyNotificationProvider();
  const line = secret('LINE_NOTIFY_TOKEN');
  if ((want === 'line' || want === 'auto') && line) return new LineNotificationProvider(line);
  const slack = secret('SLACK_WEBHOOK_URL');
  if ((want === 'slack' || want === 'auto') && slack) return new SlackNotificationProvider(slack);
  return new DbOnlyNotificationProvider();
}

/** 通知を出す。外部に飛ばせなくても必ずDBには残す（見落とし防止） */
export async function notify(input: NotificationInput): Promise<void> {
  const provider = getNotificationProvider();
  const r = await provider.send(input);
  await insert('notifications', {
    id: newId('ntf'),
    kind: input.kind,
    title: input.title,
    body: input.body,
    provider: provider.name,
    delivered: r.delivered ? 1 : 0,
    error: r.error ?? null,
    created_at: nowIso(),
  });
}

export async function recentNotifications(limit = 20) {
  return all(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`, [limit]);
}
