"""docs/data/menu.json を既存の「通常販売価格ランキング」PDF と照合する。

品名ごとに順位・提供量・税込価格が PDF と一致すること、価格の高い順に並んでいること、
同額内で 1 貫のにぎりが先頭にあること、価格なしの品が末尾に揃っていることを確認する。
（同額内の掲載順は PDF の画像順ではなく、おおよその人気順に変更している）
元 PDF はリポジトリに含めないため、パスを引数で渡す（pdftotext が必要）。

    python3 tools/verify_against_pdf.py ~/Downloads/kappa/かっぱ寿司_通常販売価格ランキング.pdf
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MENU = ROOT / "docs" / "data" / "menu.json"

ROW = re.compile(r"^\s*(\d+)位\s+(.+?)\s+(\d+(?:貫|杯|皿|個|本))\s+([\d,]+)円～\s*$")
ONE_PIECE = "1貫"
UNPRICED_NAMES = ["本日のお楽しみ寿司5貫セット", "甘ガリ", "天つゆ"]


def competition_ranks(prices):
    ranks = []
    for index, price in enumerate(prices):
        if index > 0 and price == prices[index - 1]:
            ranks.append(ranks[-1])
        else:
            ranks.append(index + 1)
    return ranks


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    text = subprocess.run(
        ["pdftotext", "-layout", sys.argv[1], "-"], check=True, capture_output=True, text=True
    ).stdout

    pdf_rows = []
    for line in text.splitlines():
        match = ROW.match(line)
        if match:
            rank, name, quantity, price = match.groups()
            name = re.sub(r"\s*※$", "", name.strip())
            pdf_rows.append((int(rank), name, quantity, int(price.replace(",", ""))))

    items = json.loads(MENU.read_text(encoding="utf-8"))["items"]
    priced = [item for item in items if item["price"] is not None]
    unpriced = [item for item in items if item["price"] is None]
    ranks = competition_ranks([item["price"] for item in priced])
    ours = [(rank, item["name"], item["quantity"], item["price"]) for rank, item in zip(ranks, priced)]

    errors = []
    if len(pdf_rows) != len(ours):
        errors.append(f"件数: PDF {len(pdf_rows)} / data {len(ours)}")
    pdf_by_name = {row[1]: row for row in pdf_rows}
    for row in ours:
        if pdf_by_name.get(row[1]) != row:
            errors.append(f"{row[1]}: PDF {pdf_by_name.get(row[1])} / data {row}")
    prices = [row[3] for row in ours]
    if prices != sorted(prices, reverse=True):
        errors.append("価格の高い順になっていない")
    for price in sorted(set(prices), reverse=True):
        group = [row[2] for row in ours if row[3] == price]
        one_piece = [q == ONE_PIECE for q in group]
        if one_piece != sorted(one_piece, reverse=True):
            errors.append(f"{price}円: 1貫の品が先頭にない")
    unpriced_names = [item["name"] for item in unpriced]
    if unpriced_names != UNPRICED_NAMES:
        errors.append(f"価格なしの品: {unpriced_names}")
    for name in UNPRICED_NAMES:
        if name not in text:
            errors.append(f"PDF に {name} がない")
    if items[-len(unpriced):] != unpriced:
        errors.append("価格なしの品が末尾にない")

    if errors:
        print("\n".join("NG: " + e for e in errors))
        sys.exit(1)
    print(f"OK: 価格あり {len(ours)} 品の順位・提供量・価格が PDF と一致、同額内は 1 貫が先頭、"
          f"価格なし {len(unpriced)} 品、計 {len(items)} 品")


if __name__ == "__main__":
    main()
