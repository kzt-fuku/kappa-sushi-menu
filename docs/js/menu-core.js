// Web ページと印刷用 PDF で共有する並び替え・順位付けの処理。
(function (global) {
  "use strict";

  // 通常価格の高い順に並べ、同額は同順位（1, 2, 2, 4 …）にする。
  // 同額内は menu.json の掲載順（1 貫のにぎりが先頭、以降はおおよその人気順）を保つ。価格のない品は末尾で順位なし。
  function rankItems(items) {
    const indexed = items.map((item, index) => ({ item, index }));
    indexed.sort((a, b) => {
      const pa = a.item.price;
      const pb = b.item.price;
      if (pa === null && pb === null) return a.index - b.index;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pb - pa || a.index - b.index;
    });

    let previousPrice = null;
    let previousRank = 0;
    return indexed.map(({ item }, position) => {
      let rank = null;
      if (item.price !== null) {
        rank = item.price === previousPrice ? previousRank : position + 1;
        previousPrice = item.price;
        previousRank = rank;
      }
      return Object.assign({}, item, { rank });
    });
  }

  // genre が null なら全品。順位は全体での順位を保ったまま絞り込む。
  function filterByGenre(rankedItems, genre) {
    if (!genre) return rankedItems;
    return rankedItems.filter((item) => item.genres.includes(genre));
  }

  // 検索用の正規化: 全角半角・大文字小文字をそろえ、カタカナをひらがなに、空白と波ダッシュを除く
  function normalizeForSearch(text) {
    return (text || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
      .replace(/[\s〜～~]/g, "");
  }

  // 品名または公式名に、正規化した検索語が含まれる品を返す（順位は全体での順位のまま）
  function searchItems(rankedItems, normalizedQuery) {
    if (!normalizedQuery) return rankedItems;
    return rankedItems.filter((item) =>
      [item.name, item.officialName].some((name) => normalizeForSearch(name).includes(normalizedQuery))
    );
  }

  function formatCheckedDate(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return `${year}年${month}月${day}日`;
  }

  global.KappaMenu = { rankItems, filterByGenre, normalizeForSearch, searchItems, formatCheckedDate };
})(window);
