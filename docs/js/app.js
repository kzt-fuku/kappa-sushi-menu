(function () {
  "use strict";

  const DATA_URL = "data/menu.json"; // 相対パス（/リポジトリ名/ 配下でも動作）
  const ALL_LABEL = "全て";
  const MAX_QUANTITY_PER_ORDER = 20;
  const TOAST_DURATION_MS = 6000;
  const STALE_RECORD_HOURS = 6; // これより前の記録が残っていたら「新しく始める」を案内する
  const MS_PER_HOUR = 60 * 60 * 1000;

  const genreList = document.getElementById("genre-list");
  const menuList = document.getElementById("menu-list");
  const status = document.getElementById("status");

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
  let currentGenre = null;
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

  function render() {
    const items = KappaMenu.filterByGenre(rankedItems, currentGenre);
    const fragment = document.createDocumentFragment();
    items.forEach((item) => fragment.appendChild(renderRow(item)));
    menuList.replaceChildren(fragment);
    status.textContent = `${currentGenre || ALL_LABEL}：${items.length}品`;
    updateOrderedBadges();
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
    updateOrderedBadges();
    if (snapshot.lines.length === 0) staleNotice.hidden = true;
  }

  document.getElementById("open-order-list").addEventListener("click", () => openSheet(orderSheet));

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

  // ---------- 初期化 ----------

  OrderStore.subscribe(onOrderChange);
  onOrderChange(OrderStore.getSnapshot());
  checkStaleRecord();

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
