#!/usr/bin/env python3
"""HTMLから「見えている文字」と「検索エンジンが読む設定」を取り出す部品。

外部ライブラリを使わない（pip install を一切いらなくする）。
理由：この道具は「動かない日を作らない」ことが最優先。依存が増えるほど、
半年後に別のPCで動かした時に壊れる。標準ライブラリだけなら壊れようがない。
"""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser


# 本文としては数えないタグ。ここを本文に混ぜると、
# メニューやスクリプトの文字数で「中身が濃いページ」に見えてしまう。
INVISIBLE_TAGS = {"script", "style", "noscript", "template", "svg"}


class PageFacts(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta_description = ""
        self.meta_robots = ""
        self.canonical = ""
        self.viewport = ""
        self.lang = ""
        self.h1 = []
        self.links = []          # (href, テキスト)
        self.images = []         # (src, altがあるか)
        self.forms = 0
        self.jsonld_raw = []
        self.text_parts = []

        self._stack = []
        self._in_title = False
        self._in_h1 = False
        self._h1_buf = []
        self._in_jsonld = False
        self._jsonld_buf = []
        self._link_buf = []

    # ---- タグの開始 ----
    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        self._stack.append(tag)

        if tag == "html":
            self.lang = a.get("lang", "")
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            name = a.get("name", "").lower()
            if name == "description":
                self.meta_description = a.get("content", "")
            elif name == "robots":
                self.meta_robots = a.get("content", "").lower()
            elif name == "viewport":
                self.viewport = a.get("content", "")
        elif tag == "link":
            rel = a.get("rel", "").lower()
            if "canonical" in rel:
                self.canonical = a.get("href", "")
        elif tag == "h1":
            self._in_h1 = True
            self._h1_buf = []
        elif tag == "a":
            self._link_buf = []
            self.links.append([a.get("href", ""), ""])
        elif tag == "img":
            self.images.append((a.get("src", ""), "alt" in a and a["alt"].strip() != ""))
        elif tag == "form":
            self.forms += 1
        elif tag == "script":
            if a.get("type", "").lower() == "application/ld+json":
                self._in_jsonld = True
                self._jsonld_buf = []

    # ---- タグの終了 ----
    def handle_endtag(self, tag):
        if self._stack and tag in self._stack:
            while self._stack:
                t = self._stack.pop()
                if t == tag:
                    break

        if tag == "title":
            self._in_title = False
        elif tag == "h1":
            self._in_h1 = False
            text = "".join(self._h1_buf).strip()
            if text:
                self.h1.append(text)
        elif tag == "a":
            if self.links:
                self.links[-1][1] = "".join(self._link_buf).strip()
            self._link_buf = []
        elif tag == "script" and self._in_jsonld:
            self._in_jsonld = False
            self.jsonld_raw.append("".join(self._jsonld_buf))

    # ---- 文字 ----
    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_jsonld:
            self._jsonld_buf.append(data)
            return
        if self._in_h1:
            self._h1_buf.append(data)
        if self._stack and self._stack[-1] == "a":
            self._link_buf.append(data)
        if not any(t in INVISIBLE_TAGS for t in self._stack):
            self.text_parts.append(data)

    # ---- 取り出し ----
    @property
    def text(self) -> str:
        raw = " ".join(self.text_parts)
        return re.sub(r"\s+", " ", raw).strip()

    def jsonld(self):
        """構造化データを読む。壊れていたら (None, エラー文) で返す。

        壊れているのを黙って捨てない。捨てると『構造化データを入れたのに
        検索側は読めていない』という一番気づきにくい壊れ方をするため。
        """
        out = []
        for raw in self.jsonld_raw:
            try:
                out.append((json.loads(raw), None))
            except Exception as e:
                out.append((None, f"{type(e).__name__}: {e}"))
        return out


def parse(html: str) -> PageFacts:
    p = PageFacts()
    p.feed(html)
    p.title = re.sub(r"\s+", " ", p.title).strip()
    return p


def jsonld_values(node, keys=("name", "headline")):
    """構造化データの中から、画面にも書かれているはずの文字を集める。"""
    found = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k in keys and isinstance(v, str):
                found.append(v)
            else:
                found.extend(jsonld_values(v, keys))
    elif isinstance(node, list):
        for v in node:
            found.extend(jsonld_values(v, keys))
    return found


def jsonld_types(node):
    types = []
    if isinstance(node, dict):
        t = node.get("@type")
        if isinstance(t, str):
            types.append(t)
        elif isinstance(t, list):
            types.extend([x for x in t if isinstance(x, str)])
        for v in node.values():
            types.extend(jsonld_types(v))
    elif isinstance(node, list):
        for v in node:
            types.extend(jsonld_types(v))
    return types
