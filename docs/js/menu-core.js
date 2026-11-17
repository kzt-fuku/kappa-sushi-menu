// Web ページと印刷用 PDF で共有する並び替え・順位付けの処理。
(function (global) {
  "use strict";

  // 通常価格の高い順に並べ、同額は同順位（1, 2, 2, 4 …）にする。
  // 同額内は menu.json の掲載順（既存 PDF の順）を保つ。価格のない品は末尾で順位なし。
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

  function formatCheckedDate(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return `${year}年${month}月${day}日`;
  }

  global.KappaMenu = { rankItems, filterByGenre, formatCheckedDate };
})(window);
