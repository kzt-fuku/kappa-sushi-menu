(function () {
  "use strict";

  const DATA_URL = "data/menu.json"; // 相対パス（/リポジトリ名/ 配下でも動作）
  const ALL_LABEL = "全て";
  const FREQUENT_KEY = "__frequent__"; // ジャンル切り替えの「よく頼む」
  const FREQUENT_LABEL = "よく頼む";
  const FREQUENT_LIMIT = 15;
  const MAX_QUANTITY_PER_ORDER = 20;
  const TOAST_DURATION_MS = 6000;
  const STALE_RECORD_HOURS = 6; // これより前の記録が残っていたら「新しく始める」を案内する
  const MS_PER_HOUR = 60 * 60 * 1000;

  const genreList = document.getElementById("genre-list");
  const menuList = document.getElementById("menu-list");
  const status = document.getElementById("status");
  const searchInput = document.getElementById("search");
  const listEmpty = document.getElementById("list-empty");

  const quantitySheet = document.getElementById("quantity-sheet");
  const quantityName = document.getElementById("quantity-name");
  const quantityMeta = document.getElementById("quantity-meta");
  const quantityValue = document.getElementById("quantity-value");
  const quantityMinus = document.getElementById("quantity-minus");
  const quantityPlus = document.getElementById("quantity-plus");
  const quantityOrder = document.getElementById("quantity-order");
  const quantityOrdered = document.getElementById("quantity-ordered");

  const orderSheet = document.getElementById("order-sheet");
  const orderLines = document.getElementById("order-lines");
  const orderEmpty = document.getElementById("order-empty");
  const orderClear = document.getElementById("order-clear");

  const toast = document.getElementById("toast");
  const toastText = document.getElementById("toast-text");
  const toastUndo = document.getElementById("toast-undo");
  const staleNotice = document.getElementById("stale-notice");
  const orderBar = document.getElementById("order-bar");

  let rankedItems = [];
  let currentGenre = null; // null=全て、FREQUENT_KEY=よく頼む、それ以外は公式ジャンル名
  let searchQuery = "";
  let selectedItem = null;
  let selectedQuantity = 1;
  let toastTimer = null;
  let pendingUndo = null;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function yen(value) {
    return `${value.toLocaleString("ja-JP")}円`;
  }

  // ---------- 一覧 ----------

  function renderGenreButtons(genres) {
    genreList.replaceChildren();
    [null, FREQUENT_KEY].concat(genres).forEach((genre) => {
      const label = genre === null ? ALL_LABEL : genre === FREQUENT_KEY ? FREQUENT_LABEL : genre;
      const button = createElement("button", "genre-button", label);
      button.type = "button";
      button.dataset.genre = genre || "";
      if (genre === FREQUENT_KEY) button.classList.add("genre-button-frequent");
      button.setAttribute("aria-pressed", String(genre === currentGenre));
      button.addEventListener("click", () => selectGenre(genre));
      genreList.appendChild(button);
    });
  }

  function renderRow(item, extra) {
    const orderable = item.price !== null;
    const listItem = createElement("li", "menu-item");
    // 価格のある品は押すと数量選択を開く。価格なしの品は注文できない
    const row = createElement(orderable ? "button" : "div", "menu-row");
    if (orderable) {
      row.type = "button";
      row.dataset.code = item.code;
      row.addEventListener("click", () => openQuantitySheet(item));
    } else {
      row.classList.add("is-unpriced");
    }

    const rankCell = createElement("span", "rank");
    rankCell.appendChild(createElement("span", "rank-num", item.rank === null ? "—" : `${item.rank}位`));
    if (orderable) rankCell.appendChild(createElement("span", "ordered-badge"));
    row.appendChild(rankCell);

    const nameCell = createElement("span", "name-cell");
    nameCell.appendChild(createElement("span", "name", item.name));
    if (item.quantity) nameCell.appendChild(createElement("span", "quantity", item.quantity));
    if (item.reason) nameCell.appendChild(createElement("span", "reason", item.reason));
    if (item.note) nameCell.appendChild(createElement("span", "note", item.note));
    if (extra) nameCell.appendChild(createElement("span", "frequency", extra));
    row.appendChild(nameCell);

    row.appendChild(createElement("span", "price", item.priceLabel));
    listItem.appendChild(row);
    return listItem;
  }

  // 一覧の各行に「注文済みの数」を表示する（行の高さは変えない）
  function updateOrderedBadges() {
    menuList.querySelectorAll(".menu-row[data-code]").forEach((row) => {
      const quantity = OrderStore.quantityOf(row.dataset.code);
      const badge = row.querySelector(".ordered-badge");
      badge.textContent = quantity > 0 ? `×${quantity}` : "";
      row.classList.toggle("is-ordered", quantity > 0);
    });
  }

  // 表示する品・状態表示・該当なしのときの案内を決める
  function currentView() {
    if (searchQuery) {
      const items = KappaMenu.searchItems(rankedItems, searchQuery);
      return {
        rows: items.map((item) => ({ item })),
        status: `「${searchInput.value.trim()}」の検索：${items.length}品`,
        empty: "一致する品はありません。ひらがな・カタカナや、名前の一部で探してください。",
      };
    }
    if (currentGenre === FREQUENT_KEY) {
      const counts = OrderStore.frequencies();
      const items = rankedItems
        .filter((item) => item.code && counts[item.code] > 0)
        .sort((a, b) => counts[b.code] - counts[a.code])
        .slice(0, FREQUENT_LIMIT);
      return {
        rows: items.map((item) => ({ item, extra: `これまでに${counts[item.code]}皿` })),
        status: `${FREQUENT_LABEL}：${items.length}品（注文した数の多い順）`,
        empty: "まだ注文の記録がありません。メニューを押して注文すると、ここに表示されます。",
      };
    }
    const items = KappaMenu.filterByGenre(rankedItems, currentGenre);
    return { rows: items.map((item) => ({ item })), status: `${currentGenre || ALL_LABEL}：${items.length}品`, empty: "" };
  }

  function render() {
    const view = currentView();
    const fragment = document.createDocumentFragment();
    view.rows.forEach(({ item, extra }) => fragment.appendChild(renderRow(item, extra)));
    menuList.replaceChildren(fragment);
    status.textContent = view.status;
    listEmpty.textContent = view.empty;
    listEmpty.hidden = view.rows.length > 0;
    updateOrderedBadges();
  }

  function updateGenrePressed() {
    genreList.querySelectorAll(".genre-button").forEach((button) => {
      button.setAttribute("aria-pressed", String((button.dataset.genre || null) === currentGenre));
    });
  }

  // 切り替え後は一覧の先頭を表示する（ヘッダーより下にいるときだけ）
  function scrollToListTop() {
    const listTop = menuList.getBoundingClientRect().top;
    const barHeight = document.querySelector(".genre-bar").offsetHeight;
    if (listTop < barHeight) {
      window.scrollBy({ top: listTop - barHeight - 40 });
    }
  }

  function selectGenre(genre) {
    currentGenre = genre;
    // ジャンルを選んだら検索は解除する
    searchInput.value = "";
    searchQuery = "";
    updateGenrePressed();
    render();
    scrollToListTop();
  }

  // 検索は「全て」から探す
  searchInput.addEventListener("input", () => {
    searchQuery = KappaMenu.normalizeForSearch(searchInput.value);
    if (searchQuery && currentGenre !== null) {
      currentGenre = null;
      updateGenrePressed();
    }
    render();
  });

  // キーボードの「検索」でキーボードを閉じて結果を見やすくする
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchInput.blur();
  });

  // ---------- シート（dialog）共通 ----------

  function openSheet(sheet) {
    document.documentElement.classList.add("sheet-open");
    if (!sheet.open) sheet.showModal();
  }

  function closeSheet(sheet) {
    if (sheet.open) sheet.close();
  }

  [quantitySheet, orderSheet].forEach((sheet) => {
    sheet.addEventListener("close", () => {
      if (!quantitySheet.open && !orderSheet.open) document.documentElement.classList.remove("sheet-open");
      if (toast.parentElement === sheet) orderBar.prepend(toast);
    });
    // 背景（シートの外側）を押したら閉じる
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) closeSheet(sheet);
    });
    sheet.querySelectorAll("[data-close]").forEach((button) => {
      button.addEventListener("click", () => closeSheet(sheet));
    });
  });

  // ---------- 数量選択 ----------

  function updateQuantityView() {
    quantityValue.textContent = String(selectedQuantity);
    quantityMinus.disabled = selectedQuantity <= 1;
    quantityPlus.disabled = selectedQuantity >= MAX_QUANTITY_PER_ORDER;
    quantityOrder.textContent = `注文 ${yen(selectedItem.price * selectedQuantity)}`;
  }

  function openQuantitySheet(item) {
    selectedItem = item;
    selectedQuantity = 1;
    quantityName.textContent = item.name;
    quantityMeta.textContent = [item.priceLabel, item.quantity].filter(Boolean).join("・");
    const ordered = OrderStore.quantityOf(item.code);
    quantityOrdered.textContent = ordered > 0 ? `注文済み ×${ordered}（${yen(item.price * ordered)}）` : "";
    updateQuantityView();
    openSheet(quantitySheet);
    quantityOrder.focus();
  }

  quantityMinus.addEventListener("click", () => {
    selectedQuantity = Math.max(1, selectedQuantity - 1);
    updateQuantityView();
  });

  quantityPlus.addEventListener("click", () => {
    selectedQuantity = Math.min(MAX_QUANTITY_PER_ORDER, selectedQuantity + 1);
    updateQuantityView();
  });

  quantityOrder.addEventListener("click", () => {
    if (!selectedItem) return;
    const item = selectedItem;
    const quantity = selectedQuantity;
    const undo = OrderStore.add(item, quantity);
    closeSheet(quantitySheet);
    showToast(`${item.name} ×${quantity} を追加（+${yen(item.price * quantity)}）`, undo);
  });

  // ---------- 取り消し付きの通知 ----------

  function hideToast() {
    clearTimeout(toastTimer);
    toast.hidden = true;
    pendingUndo = null;
  }

  function showToast(message, undo) {
    clearTimeout(toastTimer);
    // モーダル表示中は背面が操作できないため、開いているシートの中に表示する
    const host = orderSheet.open ? orderSheet : orderBar;
    if (toast.parentElement !== host) host.prepend(toast);
    toastText.textContent = message;
    pendingUndo = undo || null;
    toastUndo.hidden = !undo;
    toast.hidden = false;
    toastTimer = setTimeout(hideToast, TOAST_DURATION_MS);
  }

  toastUndo.addEventListener("click", () => {
    const undo = pendingUndo;
    hideToast();
    if (undo) {
      undo();
      showToast("取り消しました");
    }
  });

  // ---------- 注文リスト ----------

  function renderOrderLines(snapshot) {
    const fragment = document.createDocumentFragment();
    snapshot.lines.forEach((line) => {
      const row = createElement("li", "order-line");
      row.dataset.code = line.code;

      const info = createElement("div", "order-line-info");
      info.appendChild(createElement("span", "order-line-name", line.name));
      info.appendChild(createElement("span", "order-line-unit", `${yen(line.price)} × ${line.quantity}`));
      row.appendChild(info);

      row.appendChild(createElement("span", "order-line-subtotal", yen(line.price * line.quantity)));

      const controls = createElement("div", "order-line-controls");
      const stepper = createElement("div", "stepper stepper-small");
      const minus = createElement("button", "stepper-button", "−");
      minus.type = "button";
      minus.setAttribute("aria-label", `${line.name}を1つ減らす`);
      minus.disabled = line.quantity <= 1;
      minus.addEventListener("click", () => OrderStore.setQuantity(line.code, line.quantity - 1));
      const value = createElement("output", "stepper-value", String(line.quantity));
      const plus = createElement("button", "stepper-button", "＋");
      plus.type = "button";
      plus.setAttribute("aria-label", `${line.name}を1つ増やす`);
      plus.disabled = line.quantity >= OrderStore.MAX_QUANTITY_PER_LINE;
      plus.addEventListener("click", () => OrderStore.setQuantity(line.code, line.quantity + 1));
      stepper.append(minus, value, plus);

      const remove = createElement("button", "remove-button", "削除");
      remove.type = "button";
      remove.addEventListener("click", () => {
        const undo = OrderStore.remove(line.code);
        showToast(`${line.name} を削除`, undo);
      });
      controls.append(stepper, remove);
      row.appendChild(controls);

      fragment.appendChild(row);
    });
    orderLines.replaceChildren(fragment);
    orderEmpty.hidden = snapshot.lines.length > 0;
    orderClear.disabled = snapshot.lines.length === 0;
    document.getElementById("order-save-image").disabled = snapshot.lines.length === 0;
  }

  function renderTotals(snapshot) {
    const total = yen(snapshot.totalPrice);
    const count = `${snapshot.totalQuantity}皿`;
    document.getElementById("bar-total").textContent = total;
    document.getElementById("bar-count").textContent = count;
    document.getElementById("sheet-total").textContent = total;
    document.getElementById("sheet-count").textContent = count;
    document.getElementById("storage-warning").hidden = snapshot.storageAvailable;
  }

  function onOrderChange(snapshot) {
    renderTotals(snapshot);
    renderOrderLines(snapshot);
    if (currentGenre === FREQUENT_KEY && !searchQuery && rankedItems.length) render();
    else updateOrderedBadges();
    if (snapshot.lines.length === 0) staleNotice.hidden = true;
  }

  document.getElementById("open-order-list").addEventListener("click", () => openSheet(orderSheet));

  // 注文リストを画像で保存（iPhone は共有シートの「画像を保存」で写真へ）
  const saveImageButton = document.getElementById("order-save-image");
  saveImageButton.addEventListener("click", async () => {
    const snapshot = OrderStore.getSnapshot();
    if (snapshot.lines.length === 0) return;
    saveImageButton.disabled = true;
    try {
      const version = document.querySelector('meta[name="app-version"]').content;
      const result = await OrderImage.save(snapshot, { version });
      if (result === "downloaded") showToast("注文リストの画像をダウンロードしました");
    } catch (error) {
      console.error("order image failed:", error);
      showToast("画像を保存できませんでした。もう一度お試しください");
    } finally {
      saveImageButton.disabled = OrderStore.getSnapshot().lines.length === 0;
    }
  });

  orderClear.addEventListener("click", () => {
    const undo = OrderStore.clear();
    showToast("注文をすべて消去しました", undo);
  });

  // ---------- 前回の記録が残っているとき ----------

  function checkStaleRecord() {
    const snapshot = OrderStore.getSnapshot();
    if (snapshot.lines.length === 0 || !snapshot.updatedAt) return;
    if (Date.now() - snapshot.updatedAt < STALE_RECORD_HOURS * MS_PER_HOUR) return;
    const last = new Date(snapshot.updatedAt);
    const stamp = `${last.getMonth() + 1}/${last.getDate()} ${last.getHours()}:${String(last.getMinutes()).padStart(2, "0")}`;
    document.getElementById("stale-text").textContent = `前回（${stamp}）の記録 ${yen(snapshot.totalPrice)} が残っています`;
    staleNotice.hidden = false;
  }

  document.getElementById("stale-keep").addEventListener("click", () => {
    staleNotice.hidden = true;
  });

  document.getElementById("stale-reset").addEventListener("click", () => {
    staleNotice.hidden = true;
    const undo = OrderStore.clear();
    showToast("前回の記録を消去しました", undo);
  });

  // ---------- ページの説明（詳細）の開閉 ----------

  const detailsToggle = document.getElementById("details-toggle");
  const facts = document.getElementById("facts");
  detailsToggle.addEventListener("click", () => {
    const expanded = detailsToggle.getAttribute("aria-expanded") === "true";
    detailsToggle.setAttribute("aria-expanded", String(!expanded));
    facts.hidden = expanded;
  });

  // ---------- 初期化 ----------

  function showVersion() {
    const version = document.querySelector('meta[name="app-version"]').content;
    const updated = document.querySelector('meta[name="app-updated"]').content;
    document.querySelectorAll(".app-version").forEach((el) => {
      el.textContent = `v${version}（${KappaMenu.formatCheckedDate(updated)}更新）`;
    });
  }

  showVersion();

  OrderStore.subscribe(onOrderChange);
  onOrderChange(OrderStore.getSnapshot());
  checkStaleRecord();

  async function init() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      rankedItems = KappaMenu.rankItems(data.items);
      document.querySelectorAll(".checked-date").forEach((el) => {
        el.textContent = KappaMenu.formatCheckedDate(data.checkedDate);
      });
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
