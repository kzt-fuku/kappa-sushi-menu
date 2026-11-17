# かっぱ寿司 通常価格一覧

かっぱ寿司のメニュー画像に載っている全96品を、通常の店内価格（税込）が高い順に並べた一覧です。
iPhone で縦スクロールして見る Web ページと、A4 両面印刷用の PDF（2ページ）があります。
Web ページではメニューを押して注文を記録でき、画面下に今の合計金額と皿数が常に表示されます。

- 公開ページ: https://kzt-fuku.github.io/kappa-sushi-menu/
- 印刷用 PDF: https://kzt-fuku.github.io/kappa-sushi-menu/kappa-sushi-price-list.pdf

価格は 2026年11月17日に公式メニュー（https://www.kappasushi.jp/menu2 ）で確認したものです。店舗によって価格が異なります。非公式のまとめです。

## 構成

```
docs/                       GitHub Pages の公開元（main ブランチの /docs）
  index.html                入口
  css/style.css
  js/menu-core.js           並び替え・順位付け（Web と印刷用で共通）
  js/order-image.js         注文リストの画像（PNG）生成と保存
  js/order-store.js         注文記録の状態管理（localStorage に保存）
  js/app.js                 一覧表示・ジャンル切り替え・注文の記録画面
  data/menu.json            品名・価格・ジャンル・提供量・注記の共通データ
  kappa-sushi-price-list.pdf  印刷用 PDF（tools で生成）
tools/                      データ生成・PDF 生成・表示確認（公開しない）
  build_data.py             menu.json を生成し、公式 JSON と商品コードで照合
  verify_against_pdf.py     menu.json を既存のランキング PDF と照合
  print/                    印刷用レイアウト（HTML/CSS/JS）
  build-pdf.mjs             印刷用 PDF の生成とレイアウト検証
  check-layout.mjs          375px / 390px 幅での表示確認
```

## データの更新と PDF の再生成

```sh
python3 tools/build_data.py                 # 公式 JSON を取得して照合し docs/data/menu.json を出力
cd tools
npm install                                 # puppeteer-core（ローカルの Google Chrome を使用）
npm run fonts                               # PDF 埋め込み用の Noto Sans JP を取得（初回のみ）
npm run pdf                                 # docs/kappa-sushi-price-list.pdf を生成
npm run check                               # ローカルで表示確認
npm run check:live                          # 公開ページで表示確認
```

- 品名・提供量・価格は `tools/build_data.py` の `PRICED_ITEMS` / `UNPRICED_ITEMS` にあり、既存の価格ランキング PDF から転記したものです。
- 同額は同順位です。同額内は1貫のにぎりを先頭にし、以降は `POPULARITY_ORDER` の順（おおよその人気順）に並べます。人気順は公式の売上データがないため、回転寿司の人気ネタ調査とユーザー投票の傾向をもとにした目安です。
- 公式で複数ジャンルに属する品は、該当するすべてのジャンルに表示されます。キッズ・ドリンクは対象外です。
- 品名検索は「全て」から探します。ひらがな・カタカナ、全角・半角を区別せず、公式の品名（例: 生たこ）でも見つかります。
- 「よく頼む」は、これまでに消去した注文と今回の注文を合わせた数量の多い順に、最大15品を表示します。
- 注文の記録は端末ごと（各自のスマホ）に保存され、サーバーには送信しません。複数人で行くときは各自が自分のスマホで記録します。6時間以上前の記録が残っていると「新しく始める」を案内します。
- PDF の文字サイズは、全品が 4 段（表・裏の左右）に収まる最大値を自動で選び、各段の長さを揃えます。
- Chrome が標準の場所にない場合は `CHROME_PATH` で指定してください。

## バージョン

`docs/index.html` の `<meta name="app-version">` で管理し、ページ下部と注文リストに表示します。
CSS・JavaScript は `?v=バージョン` 付きで読み込むので、更新時に古いファイルがキャッシュから使われません。
バージョンを上げるときは meta と `?v=` を同じ値にしてください（`npm run check` で不一致を検出します）。

- v1.4.0（2026-11-17）注文リストを画像（PNG）で保存
- v1.3.0（2026-11-17）品名検索、よく頼む、バージョン表示
- v1.2.0（2026-11-17）注文の記録（数量選択・合計バー・注文リスト・取り消し）
- v1.1.0（2026-11-17）同額内を「1貫のにぎりが先頭、以降はおおよその人気順」に変更
- v1.0.0（2026-11-17）初版（価格一覧・ジャンル切り替え・印刷用 PDF）
