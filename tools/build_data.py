"""docs/data/menu.json を生成する。

品名・提供量・価格は既存の「通常販売価格ランキング」PDF（2026-11-17 確認）から転記したもの。
公式メニュー（https://www.kappasushi.jp/menu2）が読み込む categorylist.json / menulist.json を
商品コードで照合し、ジャンルを付与するとともに、価格が PDF と一致することを検証する。
掲載順は価格の高い順。同額内は 1 貫のにぎりを先頭にし、以降はおおよその人気順（POPULARITY_ORDER）。

使い方:
    python3 tools/build_data.py                      # 公式 JSON をダウンロードして照合
    python3 tools/build_data.py --official-dir DIR   # 保存済みの公式 JSON を使う
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "docs" / "data" / "menu.json"

OFFICIAL_BASE = "https://www.kappasushi.jp/master_data/json/"
OFFICIAL_MENU_PAGE = "https://www.kappasushi.jp/menu2"
CHECKED_DATE = "2026-11-17"
EXPECTED_ITEM_COUNT = 96

# 表示するジャンル（公式の表示順）。キッズ・ドリンクは対象外。
GENRES = [
    "期間限定ネタ",
    "定番にぎり",
    "炙り・天ぷら",
    "チーズ・マヨ",
    "肉ネタ",
    "軍艦",
    "巻物",
    "サイドメニュー",
    "デザート",
]

# 既存 PDF からの転記（PDF の掲載順）。出力時の順序は sort_key() で決める。
# (画像の品名, 公式商品コード, 提供量, 税込価格, 公式名（画像と異なる場合のみ）, 注記)
PRICED_ITEMS = [
    ("北海道祭り5貫プレート（単品）", "06220", "5貫", 759, None,
     "写真の茶碗蒸しは別注文で297円〜。合計1,056円〜"),
    ("鯛スープの塩ラーメン（メンマチャーシュー）", "06127", "1杯", 462, None, None),
    ("コク旨醤油ラーメン（メンマチャーシュー）", "06129", "1杯", 462, None, None),
    ("きつねうどん", "06793", "1杯", 407, None, None),
    ("えび天うどん", "06794", "1杯", 407, None, None),
    ("二段仕込の醤油とり唐揚げ", "06021", "1皿", 407, None, None),
    ("フライドポテト ～ケチャップ添え～", "06709", "1皿", 352, None, None),
    ("フライドポテト ～トリュフマヨ添え～", "06428", "1皿", 352, None, None),
    ("ベイクドチーズケーキ", "06718", "1個", 352, None, None),
    ("チョコレートケーキ", "06719", "1個", 352, None, None),
    ("プレミアムプリン", "06721", "1個", 352, None, None),
    ("紅茶ゼリー ～ホイップ添え～", "06524", "1皿", 352, None, None),
    ("茶碗蒸し", "06711", "1個", 297, None, None),
    ("かつお出汁入りあんかけ茶碗蒸し", "07065", "1個", 297, None, None),
    ("あさりの味噌汁", "06383", "1杯", 297, None, None),
    ("牛カルビたっぷりマヨ炙り", "06080", "2貫", 253, None, None),
    ("鉄火巻", "06321", "1本", 253, None, None),
    ("あおさの味噌汁", "06772", "1杯", 253, None, None),
    ("アボカドサーモン", "06122", "2貫", 209, None, None),
    ("えんがわ", "06282", "2貫", 209, None, None),
    ("たこ", "06594", "2貫", 209, "生たこ", None),
    ("つぶ貝", "06243", "2貫", 209, None, None),
    ("赤貝", "06272", "2貫", 209, None, None),
    ("とろサーモン", "06239", "2貫", 209, None, None),
    ("とろサーモン塩炙り", "06124", "2貫", 209, None, None),
    ("中とろ", "06237", "1貫", 209, None, None),
    ("活〆真鯛", "06638", "2貫", 209, "活〆真鯛（二貫）", None),
    ("牛カルビ炙り", "06281", "2貫", 209, None, None),
    ("ねぎとろ巻", "06319", "1本", 209, None, None),
    ("えび天巻", "06720", "1本", 209, None, None),
    ("玉ねぎと油揚げの味噌汁", "06606", "1杯", 209, None, None),
    ("玉ねぎ天盛り", "06693", "1皿", 209, None, None),
    ("なす天盛り ～天つゆ付き～", "06786", "1皿", 209, None, None),
    ("しっとりクリームケーキ", "06433", "1個", 209, None, None),
    ("国産炭焼きかつおたたき（2貫）", "06560", "2貫", 176, None, None),
    ("活〆はまち（2貫）", "06139", "2貫", 176, None, None),
    ("サーモンマヨ炙り", "06617", "2貫", 176, None, None),
    ("サーモンマヨペッパー炙り", "06618", "2貫", 176, None, None),
    ("あかいかゲソ（大葉）", "07329", "2貫", 176, None, None),
    ("あかいかゲソマヨ", "06156", "2貫", 176, None, None),
    ("えびマヨ炙り", "06609", "2貫", 176, None, None),
    ("えびマヨペッパー炙り", "06610", "2貫", 176, None, None),
    ("浜焼き風 えび", "06615", "2貫", 176, None, None),
    ("〆いわし", "06475", "2貫", 176, None, None),
    ("オニオンサーモンマヨ", "06039", "2貫", 176, None, None),
    ("赤えび", "06120", "1貫", 176, None, None),
    ("生えび", "06196", "2貫", 176, None, None),
    ("オニオンえびマヨ", "06152", "2貫", 176, None, None),
    ("煮穴子", "06024", "2貫", 176, None, None),
    ("まいたけ天にぎり", "06064", "2貫", 176, None, None),
    ("合鴨ロースオニオンマヨ", "06339", "2貫", 176, None, None),
    ("えび天にぎり", "06669", "2貫", 176, None, None),
    ("えび天にぎりマヨ", "06667", "2貫", 176, None, None),
    ("さくさくイカ天にぎり", "06668", "2貫", 176, None, None),
    ("さくさくイカ天にぎりマヨ", "06603", "2貫", 176, None, None),
    ("ししゃもっこ軍艦", "06128", "2貫", 176, None, None),
    ("かにみそ", "06445", "2貫", 176, None, None),
    ("卵黄納豆軍艦", "06842", "2貫", 176, None, None),
    ("卵黄とろろ軍艦", "07188", "2貫", 176, None, None),
    ("干ぴょう巻", "06359", "1本", 176, None, None),
    ("かにカマきゅうりコーン小鉢", "06782", "1皿", 176, None, None),
    ("まぐろ", "06060", "2貫", 121, None, None),
    ("なす揚げびたし", "06808", "2貫", 121, "なすの揚げびたし", None),
    ("合鴨ロース", "06320", "2貫", 121, None, None),
    ("てりやきハンバーグ", "09262", "2貫", 121, None, None),
    ("てりやきハンバーグマヨ", "09263", "2貫", 121, None, None),
    ("感動コーンかっぱ軍艦", "06755", "2貫", 121, None, None),
    ("かにカマサラダかっぱ軍艦", "06255", "2貫", 121, None, None),
    ("まぐたく軍艦", "08711", "2貫", 121, None, None),
    ("さっぱりシューアイス", "06399", "1皿", 121, None, None),
    ("ねぎとろにぎり", "06262", "2貫", 110, None, None),
    ("びん長まぐろ", "06091", "2貫", 110, None, None),
    ("サーモン", "06004", "2貫", 110, None, None),
    ("いか", "06015", "2貫", 110, "天然むらさきいか", None),
    ("えび", "06010", "2貫", 110, None, None),
    ("とろ〆さば", "06307", "1貫", 110, None, None),
    ("玉子", "06035", "2貫", 110, None, None),
    ("いなり", "06740", "2貫", 110, None, None),
    ("ねぎとろ軍艦", "06552", "2貫", 110, None, None),
    ("オクラいかめかぶ軍艦", "06131", "2貫", 110, None, None),
    ("オクラいかめかぶ納豆軍艦", "06138", "2貫", 110, None, None),
    ("たらこ軍艦", "08637", "2貫", 110, None, None),
    ("たらこマヨ軍艦", "09465", "2貫", 110, None, None),
    ("かにカマサラダ軍艦", "06192", "2貫", 110, None, None),
    ("サラダ軍艦", "06554", "2貫", 110, None, None),
    ("感動コーン", "08552", "2貫", 110, None, None),
    ("なっとう軍艦", "06555", "2貫", 110, None, None),
    ("かっぱ巻", "06686", "1本", 110, None, None),
    ("なっとう巻", "06684", "1本", 110, None, None),
    ("甘ガリ天盛り", "06335", "1皿", 110, None, None),
    ("かっぱのシャリドーナツ きな粉（2個）", "06183", "2個", 110, None, None),
    ("かっぱのシャリドーナツ キャラメルシナモン（2個）", "06543", "2個", 110, None, None),
    ("京わらび餅", "06379", "1皿", 110, None, None),
]

# 同額内の掲載順。1 貫のにぎり（提供量が ONE_PIECE）を先頭にし、以降はこのリストの順（おおよその人気順）。
# 人気順は公式の売上データがないため、回転寿司の人気ネタ調査（サーモン・まぐろが上位、
# 炙りサーモンマヨなど）と、かっぱ寿司のユーザー投票の傾向をもとにした目安。
ONE_PIECE = "1貫"
POPULARITY_ORDER = [
    # 759円
    "北海道祭り5貫プレート（単品）",
    # 462円
    "鯛スープの塩ラーメン（メンマチャーシュー）",
    "コク旨醤油ラーメン（メンマチャーシュー）",
    # 407円
    "二段仕込の醤油とり唐揚げ",
    "えび天うどん",
    "きつねうどん",
    # 352円
    "フライドポテト ～ケチャップ添え～",
    "プレミアムプリン",
    "フライドポテト ～トリュフマヨ添え～",
    "チョコレートケーキ",
    "ベイクドチーズケーキ",
    "紅茶ゼリー ～ホイップ添え～",
    # 297円
    "茶碗蒸し",
    "あさりの味噌汁",
    "かつお出汁入りあんかけ茶碗蒸し",
    # 253円
    "牛カルビたっぷりマヨ炙り",
    "鉄火巻",
    "あおさの味噌汁",
    # 209円
    "中とろ",
    "とろサーモン",
    "とろサーモン塩炙り",
    "アボカドサーモン",
    "活〆真鯛",
    "たこ",
    "えんがわ",
    "牛カルビ炙り",
    "ねぎとろ巻",
    "つぶ貝",
    "赤貝",
    "えび天巻",
    "玉ねぎ天盛り",
    "なす天盛り ～天つゆ付き～",
    "玉ねぎと油揚げの味噌汁",
    "しっとりクリームケーキ",
    # 176円
    "赤えび",
    "サーモンマヨ炙り",
    "活〆はまち（2貫）",
    "えびマヨ炙り",
    "生えび",
    "オニオンサーモンマヨ",
    "えび天にぎり",
    "煮穴子",
    "国産炭焼きかつおたたき（2貫）",
    "サーモンマヨペッパー炙り",
    "えびマヨペッパー炙り",
    "オニオンえびマヨ",
    "〆いわし",
    "あかいかゲソ（大葉）",
    "あかいかゲソマヨ",
    "浜焼き風 えび",
    "えび天にぎりマヨ",
    "さくさくイカ天にぎり",
    "さくさくイカ天にぎりマヨ",
    "まいたけ天にぎり",
    "合鴨ロースオニオンマヨ",
    "かにみそ",
    "卵黄納豆軍艦",
    "卵黄とろろ軍艦",
    "ししゃもっこ軍艦",
    "干ぴょう巻",
    "かにカマきゅうりコーン小鉢",
    # 121円
    "まぐろ",
    "まぐたく軍艦",
    "てりやきハンバーグ",
    "合鴨ロース",
    "感動コーンかっぱ軍艦",
    "かにカマサラダかっぱ軍艦",
    "てりやきハンバーグマヨ",
    "なす揚げびたし",
    "さっぱりシューアイス",
    # 110円
    "とろ〆さば",
    "サーモン",
    "えび",
    "ねぎとろにぎり",
    "びん長まぐろ",
    "ねぎとろ軍艦",
    "サラダ軍艦",
    "いか",
    "玉子",
    "感動コーン",
    "いなり",
    "かっぱ巻",
    "なっとう軍艦",
    "なっとう巻",
    "たらこマヨ軍艦",
    "かにカマサラダ軍艦",
    "たらこ軍艦",
    "オクラいかめかぶ軍艦",
    "オクラいかめかぶ納豆軍艦",
    "かっぱのシャリドーナツ きな粉（2個）",
    "かっぱのシャリドーナツ キャラメルシナモン（2個）",
    "京わらび餅",
    "甘ガリ天盛り",
]

# 通常販売価格を確認できなかった品（一覧の末尾に掲載）。
# (画像の品名, 理由, 注記)
UNPRICED_ITEMS = [
    ("本日のお楽しみ寿司5貫セット", "食べ放題専用",
     "公式発表で食べ放題向けのセットとして掲載。通常販売価格の掲載なし"),
    ("甘ガリ", "単品価格の掲載なし", "甘ガリ天盛りは別商品として110円〜"),
    ("天つゆ", "単品価格の掲載なし", "なす天盛りの付属品として公式メニューに掲載"),
]


def load_official(official_dir):
    data = {}
    for name in ("categorylist", "menulist"):
        if official_dir:
            text = (Path(official_dir) / f"{name}.json").read_text(encoding="utf-8")
        else:
            request = urllib.request.Request(
                OFFICIAL_BASE + f"{name}.json", headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                text = response.read().decode("utf-8")
        data[name] = json.loads(text)
    categories = data["categorylist"]["BrandCategory"]
    products = {p["code"]: p for p in data["menulist"]["Product"]}
    return categories, products


def sort_key(item):
    """価格の高い順 → 同額内は 1 貫のにぎりが先 → おおよその人気順。"""
    return (-item["price"], item["quantity"] != ONE_PIECE, POPULARITY_ORDER.index(item["name"]))


def build(categories, products):
    genres_by_code = {}
    for category in categories:
        name = category["category_name"]
        if name not in GENRES:
            continue
        for code in category["product_lists"]:
            genres_by_code.setdefault(code, set()).add(name)

    errors = []
    items = []
    for name, code, quantity, price, official_name, note in PRICED_ITEMS:
        product = products.get(code)
        if product is None:
            errors.append(f"{name}: 公式に商品コード {code} がない")
            continue
        official_price = int(product["sell_price_tax10per"])
        if official_price != price:
            errors.append(f"{name}: PDF {price}円 / 公式 {official_price}円 が不一致")
        genres = [g for g in GENRES if g in genres_by_code.get(code, set())]
        if not genres:
            errors.append(f"{name}: 対象ジャンルに属していない")
        if official_name:
            mapping = f"公式名「{official_name}」"
            note = f"{mapping}。{note}" if note else mapping
        items.append({
            "name": name,
            # 検索用。画像と公式で名前が違う品は既存 PDF の対応、それ以外は公式の品名
            "officialName": official_name or re.sub(r"<br\s*/?>", "", product["name"]),
            "code": code,
            "quantity": quantity,
            "price": price,
            "priceLabel": f"{price}円〜",
            "genres": genres,
            "reason": None,
            "note": note,
        })

    missing = {item["name"] for item in items} ^ set(POPULARITY_ORDER)
    if missing or len(POPULARITY_ORDER) != len(set(POPULARITY_ORDER)):
        errors.append(f"POPULARITY_ORDER と品名が一致しない: {sorted(missing)}")
        return items, errors
    items.sort(key=sort_key)

    for name, reason, note in UNPRICED_ITEMS:
        items.append({
            "name": name,
            "officialName": None,
            "code": None,
            "quantity": None,
            "price": None,
            "priceLabel": "—",
            "genres": [],
            "reason": reason,
            "note": note,
        })

    names = [item["name"] for item in items]
    if len(items) != EXPECTED_ITEM_COUNT:
        errors.append(f"品数が {len(items)} 品（期待値 {EXPECTED_ITEM_COUNT} 品）")
    if len(set(names)) != len(names):
        errors.append("品名が重複している")
    codes = [item["code"] for item in items if item["code"]]
    if len(set(codes)) != len(codes):
        errors.append("商品コードが重複している")

    return items, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--official-dir", help="保存済みの categorylist.json / menulist.json のディレクトリ")
    args = parser.parse_args()

    categories, products = load_official(args.official_dir)
    items, errors = build(categories, products)
    if errors:
        for error in errors:
            print("ERROR:", error, file=sys.stderr)
        sys.exit(1)

    data = {
        "checkedDate": CHECKED_DATE,
        "officialMenuUrl": OFFICIAL_MENU_PAGE,
        "genres": GENRES,
        "items": items,
    }
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}: {len(items)} items")


if __name__ == "__main__":
    main()
