// 印刷用ページの描画。全品を 4 つの段（1 枚目左→右、2 枚目左→右）に上から順に詰める。
// 描画結果は window.printLayout に格納し、build-pdf.mjs が検証する。
(function () {
  "use strict";

  const DATA_URL = "../../docs/data/menu.json";
  const OVERFLOW_TOLERANCE_PX = 0.5;
  const MAX_LIST_FONT_PT = 12;
  const MIN_LIST_FONT_PT = 7;
  const LIST_FONT_STEP_PT = 0.1;
  const BALANCE_PRECISION_PX = 1;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function columnHead() {
    const head = createElement("div", "col-head");
    head.appendChild(createElement("span", null, "順位"));
    head.appendChild(createElement("span", null, "品名"));
    head.appendChild(createElement("span", "price-head", "税込価格"));
    return head;
  }

  function renderRow(item) {
    const row = createElement("div", "row");
    row.dataset.name = item.name;
    row.appendChild(createElement("span", "rank", item.rank === null ? "—" : `${item.rank}位`));

    const nameCell = createElement("div", "name-cell");
    nameCell.appendChild(createElement("span", "name", item.name));
    if (item.quantity) nameCell.appendChild(createElement("span", "quantity", item.quantity));
    if (item.reason) nameCell.appendChild(createElement("span", "reason", item.reason));
    if (item.note) nameCell.appendChild(createElement("span", "note", item.note));
    row.appendChild(nameCell);

    row.appendChild(createElement("span", "price", item.priceLabel));
    return row;
  }

  // limitPx: 各段で使う高さの上限（段の実際の高さとの小さい方を使う）
  function overflows(column, limitPx) {
    const contentHeight = column.lastElementChild.getBoundingClientRect().bottom - column.getBoundingClientRect().top;
    return contentHeight > Math.min(column.clientHeight, limitPx) + OVERFLOW_TOLERANCE_PX;
  }

  function fill(items, limitPx = Infinity) {
    const columns = Array.from(document.querySelectorAll(".col"));
    columns.forEach((column) => column.replaceChildren(columnHead()));

    let columnIndex = 0;
    const unplaced = [];
    for (const item of items) {
      const row = renderRow(item);
      while (columnIndex < columns.length) {
        columns[columnIndex].appendChild(row);
        if (!overflows(columns[columnIndex], limitPx)) break;
        row.remove();
        columnIndex += 1;
      }
      if (columnIndex >= columns.length) unplaced.push(item.name);
    }

    return {
      total: items.length,
      unplaced,
      columns: columns.map((column) => Array.from(column.querySelectorAll(".row")).map((r) => r.dataset.name)),
    };
  }

  // 1. 一覧の文字サイズを大きい方から試し、全品が 4 段に収まる最大のサイズを採用する
  // 2. その文字サイズで、全品が収まる最小の「段の高さ上限」を二分探索し、4 段の長さを揃える
  function layout(items) {
    const style = document.documentElement.style;
    let fontSizePt = null;
    for (let size = MAX_LIST_FONT_PT; size >= MIN_LIST_FONT_PT - 1e-9; size -= LIST_FONT_STEP_PT) {
      style.setProperty("--list-font-size", `${size.toFixed(2)}pt`);
      if (fill(items).unplaced.length === 0) {
        fontSizePt = Number(size.toFixed(2));
        break;
      }
    }
    if (fontSizePt === null) {
      return Object.assign(fill(items), { fontSizePt: MIN_LIST_FONT_PT });
    }

    let low = 0;
    let high = Math.max(...Array.from(document.querySelectorAll(".col"), (c) => c.clientHeight));
    while (high - low > BALANCE_PRECISION_PX) {
      const middle = (low + high) / 2;
      if (fill(items, middle).unplaced.length === 0) high = middle;
      else low = middle;
    }
    return Object.assign(fill(items, high), { fontSizePt });
  }

  async function init() {
    const response = await fetch(DATA_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`menu.json HTTP ${response.status}`);
    const data = await response.json();
    const ranked = KappaMenu.rankItems(data.items);

    document.querySelectorAll(".checked-date").forEach((el) => {
      el.textContent = KappaMenu.formatCheckedDate(data.checkedDate);
    });
    document.querySelectorAll(".total-count").forEach((el) => { el.textContent = String(ranked.length); });
    document.querySelectorAll(".unpriced-count").forEach((el) => {
      el.textContent = String(ranked.filter((item) => item.price === null).length);
    });
    document.querySelectorAll(".source").forEach((el) => {
      el.textContent = `出典: かっぱ寿司 公式メニュー ${data.officialMenuUrl}`;
    });

    await document.fonts.ready;
    window.printLayout = layout(ranked);
  }

  init().catch((error) => {
    console.error(error);
    window.printLayout = { error: String(error) };
  });
})();
