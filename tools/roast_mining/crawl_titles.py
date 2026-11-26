"""R1: 커뮤니티 목록 페이지에서 글 '제목'만 자동 수집한다.

- 본문·댓글·이미지는 열지 않는다(토큰·트래픽 절약, 원문 보관 최소화).
- 요청 사이 delay_sec 쉬고, 정직한 User-Agent를 쓴다. 403/429/차단 페이지는 우회하지 않고 기록만 하고 넘어간다.
- 결과: game_research/roast_mining/raw/titles_<날짜>.jsonl  (game_research/ 는 .gitignore)

사용:  python tools/roast_mining/crawl_titles.py [--pages 5] [--only dc_fashion,fm_humor]
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CFG = Path(__file__).with_name("sources.json")
OUT_DIR = ROOT / "game_research" / "roast_mining" / "raw"


class AnchorTitles(HTMLParser):
    """href가 link_re에 맞는 <a> 안의 텍스트를 제목으로 모은다."""

    def __init__(self, link_re: re.Pattern[str]):
        super().__init__(convert_charrefs=True)
        self.link_re = link_re
        self.depth = 0  # 맞는 <a> 안에 있는지
        self.href = ""
        self.buf: list[str] = []
        self.items: list[tuple[str, str]] = []
        self.skip = 0  # <script>/<style> 안

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        if tag == "a":
            href = html.unescape(dict(attrs).get("href") or "")
            if self.depth:
                self.depth += 1
            elif self.link_re.search(href):
                self.depth, self.href, self.buf = 1, href, []

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1
        if tag == "a" and self.depth:
            self.depth -= 1
            if self.depth == 0:
                text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
                text = re.sub(r"\s*\[\d+\]$", "", text)  # 끝의 댓글 수 [12] 제거
                if text:
                    self.items.append((text, self.href))

    def handle_data(self, data):
        if self.depth and not self.skip:
            self.buf.append(data)


def fetch(url: str, ua: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Language": "ko-KR,ko;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            charset = r.headers.get_content_charset() or "utf-8"
            return r.status, raw.decode(charset, errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception:  # 네트워크 오류
        return -1, ""


NOTICE_RE = re.compile(r"(이용\s*안내|공지|자료안내|규정|설문|이벤트|광고|패치|뉴스\]|\[AD\])")


def clean_title(t: str) -> str | None:
    t = t.strip()
    t = re.sub(r"\d{1,2}:\d{2}\s*l\s*조회\s*[\d,]+$", "", t).strip()  # 인스티즈: 끝의 '12:34 l 조회 60'
    t = re.sub(r"\s*\(\d+\)$", "", t).strip()  # 루리웹: 끝의 댓글 수 (109)
    t = re.sub(r"^\d{1,2}\s+(?=\S)", "", t).strip()  # 루리웹: 앞의 순위 번호
    if NOTICE_RE.search(t) or re.fullmatch(r"\[[^\]]*\]", t):
        return None
    if len(t) < 4 or len(t) > 80:
        return None
    if re.fullmatch(r"[\d\s.,:/\-]+", t):  # 숫자·날짜만
        return None
    if t in {"공지", "설문", "AD", "광고"}:
        return None
    return t


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int)
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    pages = args.pages or cfg["default_pages"]
    only = {s for s in args.only.split(",") if s}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M")
    out = OUT_DIR / f"titles_{stamp}.jsonl"
    log = OUT_DIR / f"crawl_log_{stamp}.json"

    seen: set[tuple[str, str]] = set()
    stats: dict[str, dict] = {}
    n_total = 0
    with out.open("w", encoding="utf-8") as f:
        for src in cfg["sources"]:
            if only and src["id"] not in only:
                continue
            rx = re.compile(src["link_re"])
            st = stats.setdefault(src["id"], {"pages_ok": 0, "pages_fail": [], "titles": 0})
            for p in range(1, pages + 1):
                url = src["url"].format(page=p)
                code, body = fetch(url, cfg["user_agent"])
                time.sleep(cfg["delay_sec"])
                if code != 200 or not body:
                    st["pages_fail"].append({"page": p, "status": code})
                    if code in (403, 429, 430):  # 차단·과다요청 → 이 출처는 중단(우회 안 함)
                        break
                    continue
                parser = AnchorTitles(rx)
                parser.feed(body)
                got = 0
                for title, href in parser.items:
                    t = clean_title(title)
                    if not t or (src["id"], t) in seen:
                        continue
                    seen.add((src["id"], t))
                    rec = {"source": src["id"], "site": src["site"], "board": src["board"], "page": p,
                           "title": t, "href": href, "fetched_at": dt.datetime.now().isoformat(timespec="seconds")}
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    got += 1
                st["pages_ok"] += 1
                st["titles"] += got
                n_total += got
                if got == 0:
                    st["pages_fail"].append({"page": p, "status": "no_titles_parsed"})
            print(f"[{src['id']}] pages_ok={st['pages_ok']} titles={st['titles']} fail={st['pages_fail']}", flush=True)

    log.write_text(json.dumps({"out": str(out), "pages": pages, "total": n_total, "stats": stats}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"total={n_total} -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
