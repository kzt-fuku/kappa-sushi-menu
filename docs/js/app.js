(function () {
  "use strict";

  const DATA_URL = "data/menu.json"; // 相対パス（/リポジトリ名/ 配下でも動作）
  const ALL_LABEL = "全て";

  const genreList = document.getElementById("genre-list");
  const menuList = document.getElementById("menu-list");
  const status = document.getElementById("status");

  let rankedItems = [];
  let currentGenre = null;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function renderGenreButtons(genres) {
    genreList.replaceChildren();
    [null].concat(genres).forEach((genre) => {
      const button = createElement("button", "genre-button", genre || ALL_LABEL);
      button.type = "button";
      button.dataset.genre = genre || "";
      button.setAttribute("aria-pressed", String(genre === currentGenre));
      button.addEventListener("click", () => selectGenre(genre));
      genreList.appendChild(button);
    });
  }

  function renderRow(item) {
    const row = createElement("li", "menu-row");
    if (item.price === null) row.classList.add("is-unpriced");

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

  function render() {
    const items = KappaMenu.filterByGenre(rankedItems, currentGenre);
    const fragment = document.createDocumentFragment();
    items.forEach((item) => fragment.appendChild(renderRow(item)));
    menuList.replaceChildren(fragment);
    status.textContent = `${currentGenre || ALL_LABEL}：${items.length}品`;
  }

  function selectGenre(genre) {
    currentGenre = genre;
    genreList.querySelectorAll(".genre-button").forEach((button) => {
      button.setAttribute("aria-pressed", String((button.dataset.genre || null) === genre));
    });
    render();
    // 切り替え後は一覧の先頭を表示する（ヘッダーより下にいるときだけ）
    const listTop = menuList.getBoundingClientRect().top;
    const barHeight = document.querySelector(".genre-bar").offsetHeight;
    if (listTop < barHeight) {
      window.scrollBy({ top: listTop - barHeight - 40 });
    }
  }

  async function init() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      rankedItems = KappaMenu.rankItems(data.items);
      document.getElementById("checked-date").textContent = KappaMenu.formatCheckedDate(data.checkedDate);
      document.getElementById("total-count").textContent = String(data.items.length);
      document.getElementById("official-link").href = data.officialMenuUrl;

      renderGenreButtons(data.genres);
      render();
    } catch (error) {
      console.error("menu data load failed:", error);
      status.textContent = "価格データを読み込めませんでした。通信状況を確認して再読み込みしてください。";
      status.classList.add("is-error");
    }
  }

  init();
})();
