"""メール通知（SMTP）"""
import os
import smtplib
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime


def format_insights_html(insights: dict) -> str:
    """Insights を読みやすいHTMLに整形"""
    def section(title, items, render):
        if not items:
            return f"<h3>{title}</h3><p style='color:#888'>該当なし</p>"
        rendered = "".join(render(i) for i in items)
        return f"<h3>{title}</h3>{rendered}"

    summary = insights.get("summary", "")
    wins = insights.get("top_wins", [])
    concerns = insights.get("top_concerns", [])

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{{font-family:sans-serif;max-width:720px;margin:20px auto;padding:0 16px;line-height:1.7}}
h2{{color:#0b6fd3;border-bottom:2px solid #0b6fd3;padding-bottom:6px}}
h3{{color:#063a7a;margin-top:24px}}
.summary{{background:#f6f8fb;padding:16px;border-left:4px solid #0b6fd3;border-radius:4px}}
.item{{margin:8px 0;padding:10px 14px;background:#fff;border:1px solid #dce3ed;border-radius:4px}}
.item strong{{color:#063a7a}}
.win{{border-left:3px solid #19a974}}
.concern{{border-left:3px solid #d84b5b}}
ul{{padding-left:20px}}li{{margin:4px 0}}
.muted{{color:#68748a;font-size:13px}}
</style></head><body>
<h2>🤖 通信比較ナビ 日次レポート</h2>
<p class="muted">{datetime.now():%Y-%m-%d %H:%M}</p>

<div class="summary">
  <strong>サマリー:</strong><br>{summary}
</div>

{section("🌟 勝ち要因", wins, lambda i: f'<div class="item win">{i}</div>')}
{section("⚠️ 懸念事項", concerns, lambda i: f'<div class="item concern">{i}</div>')}

{section("🛑 停止候補KW", insights.get("kw_stop", []),
  lambda i: f'<div class="item"><strong>{i.get("keyword","")}</strong> — {i.get("reason","")}（信頼度: {i.get("confidence","")}）</div>')}

{section("🚀 強化候補KW", insights.get("kw_boost", []),
  lambda i: f'<div class="item"><strong>{i.get("keyword","")}</strong> — {i.get("reason","")}<br>推奨: {i.get("suggested_action","")}</div>')}

{section("➕ 新規追加候補KW", insights.get("kw_add_candidates", []),
  lambda i: f'<div class="item"><strong>{i.get("search_term","")}</strong> — {i.get("reason","")}</div>')}

{section("📝 広告文改善案", insights.get("ad_improve", []),
  lambda i: f'<div class="item"><strong>広告 {i.get("ad_id","")}:</strong> {i.get("issue","")}<br>💡 {i.get("recommendation","")}</div>')}

{section("🎨 LP改善案", insights.get("lp_improve", []),
  lambda i: f'<div class="item"><strong>{i.get("lp_path","")}:</strong> {i.get("issue","")}<br>💡 {i.get("recommendation","")}</div>')}

{section("🚨 緊急対応（人間判断）", insights.get("urgent_actions", []),
  lambda i: f'<div class="item concern">{i}</div>')}

<hr style="margin:30px 0;border:0;border-top:1px solid #dce3ed">
<p class="muted">© 通信比較ナビ AI自動分析 / 詳細は Google Sheets で確認</p>
</body></html>"""
    return html


def send_daily_report(insights: dict):
    smtp_host = os.getenv("NOTIFY_EMAIL_SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("NOTIFY_EMAIL_SMTP_PORT", "587"))
    smtp_user = os.getenv("NOTIFY_EMAIL_SMTP_USER", "")
    smtp_pass = os.getenv("NOTIFY_EMAIL_SMTP_PASS", "")
    email_to = os.getenv("NOTIFY_EMAIL_TO", "")
    email_from = os.getenv("NOTIFY_EMAIL_FROM", smtp_user)

    if not all([smtp_user, smtp_pass, email_to]):
        print(f"  → メール設定未完了。レポートをコンソール出力します。")
        print(json.dumps(insights, ensure_ascii=False, indent=2))
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"📊 通信比較ナビ 日次レポート ({datetime.now():%Y-%m-%d})"
    msg["From"] = email_from
    msg["To"] = email_to

    html = format_insights_html(insights)
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
