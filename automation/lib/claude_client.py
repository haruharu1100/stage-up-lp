"""Claude API ラッパー（分析・改善案生成）"""
import os
import json


class ClaudeClient:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run or os.getenv("DRY_RUN", "false").lower() == "true"
        self.api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.model = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-7-20251101")
        self._configured = bool(self.api_key)
        self.client = None
        if self._configured and not self.dry_run:
            from anthropic import Anthropic
            self.client = Anthropic(api_key=self.api_key)

    def is_ready(self) -> bool:
        return self._configured and not self.dry_run

    def analyze(self, prompt: str, max_tokens: int = 4096, system: str = None):
        """Claude にプロンプトを投げて応答を返す"""
        if not self.is_ready():
            return self._mock_response(prompt)
        try:
            msg = self.client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system or "あなたは通信ジャンル アフィリエイト運用のプロアナリストです。データに基づいて具体的な改善案を提案してください。",
                messages=[{"role": "user", "content": prompt}],
            )
            return msg.content[0].text if msg.content else ""
        except Exception as e:
            print(f"  ⚠️  Claude API error: {e}")
            return self._mock_response(prompt)

    def analyze_json(self, prompt: str, max_tokens: int = 4096):
        """JSON出力を期待する分析"""
        full_prompt = prompt + "\n\n回答は以下のJSON形式のみで返してください。説明文・前置きは不要です。"
        text = self.analyze(full_prompt, max_tokens=max_tokens)
        # JSON抽出（コードブロック対応）
        text = text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        try:
            return json.loads(text.strip())
        except json.JSONDecodeError:
            print(f"  ⚠️  JSON parse error. Raw response: {text[:200]}...")
            return {}

    def _mock_response(self, prompt):
        if "JSON" in prompt or "json" in prompt:
            return json.dumps({
                "summary": "（モック）昨日は13クリック・¥2,301消化・CV0件。CTR 24.07%は異常値で好調。",
                "top_wins": ["CTR 24.07% は業界平均の5倍", "平均CPC ¥177 は想定の半額以下"],
                "top_concerns": ["CV 0件継続（要 学習データ蓄積）"],
                "kw_stop": [],
                "kw_boost": [],
                "ad_improve": [],
                "lp_improve": [],
                "urgent_actions": [],
            }, ensure_ascii=False, indent=2)
        return "（モック）データ不足のため具体的な提案は次回以降に。"
