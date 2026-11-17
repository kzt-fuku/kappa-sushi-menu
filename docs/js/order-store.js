// 注文記録の状態管理。端末の localStorage に保存し、再読み込みやタブの破棄でも消えないようにする。
// 画面には依存しない（app.js から使う）。
(function (global) {
  "use strict";

  const STORAGE_KEY = "kappa-sushi-order-v1";
  // 「よく頼む」用の過去の注文数（コード→数量）。今回の記録を消去するときに加算する
  const HISTORY_KEY = "kappa-sushi-history-v1";
  const SCHEMA_VERSION = 1;
  const MAX_QUANTITY_PER_LINE = 99;

  // lines: [{ code, name, price, quantity, addedAt }]（最初に注文した順）
  let state = { version: SCHEMA_VERSION, updatedAt: null, lines: [] };
  let history = {};
  const listeners = [];
  let storageAvailable = true;

  function isValidLine(line) {
    return (
      line &&
      typeof line.code === "string" &&
      typeof line.name === "string" &&
      Number.isInteger(line.price) && line.price > 0 &&
      Number.isInteger(line.quantity) && line.quantity > 0
    );
  }

  function load() {
    try {
      const rawHistory = global.localStorage.getItem(HISTORY_KEY);
      const parsedHistory = rawHistory ? JSON.parse(rawHistory) : null;
      if (parsedHistory && parsedHistory.version === SCHEMA_VERSION && parsedHistory.counts) {
        Object.entries(parsedHistory.counts).forEach(([code, count]) => {
          if (Number.isInteger(count) && count > 0) history[code] = count;
        });
      }
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.lines)) {
        state = {
          version: SCHEMA_VERSION,
          updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : null,
          lines: parsed.lines.filter(isValidLine),
        };
      }
    } catch (error) {
      storageAvailable = false;
      console.warn("order load failed:", error);
    }
  }

  function save() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      global.localStorage.setItem(HISTORY_KEY, JSON.stringify({ version: SCHEMA_VERSION, counts: history }));
      storageAvailable = true;
    } catch (error) {
      // プライベートブラウズ等で保存できなくても、画面上の記録は続ける
      storageAvailable = false;
      console.warn("order save failed:", error);
    }
  }

  function commit(nextLines) {
    state = { version: SCHEMA_VERSION, updatedAt: Date.now(), lines: nextLines };
    save();
    listeners.forEach((listener) => listener(getSnapshot()));
  }

  function cloneLines() {
    return state.lines.map((line) => Object.assign({}, line));
  }

  function getSnapshot() {
    const lines = cloneLines();
    return {
      lines,
      totalPrice: lines.reduce((sum, line) => sum + line.price * line.quantity, 0),
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      updatedAt: state.updatedAt,
      storageAvailable,
    };
  }

  function quantityOf(code) {
    const line = state.lines.find((l) => l.code === code);
    return line ? line.quantity : 0;
  }

  // 戻り値は取り消し用の関数
  function add(item, quantity) {
    if (!item.code || item.price === null || !Number.isInteger(quantity) || quantity < 1) {
      throw new Error("注文できない品または数量です");
    }
    const before = cloneLines();
    const lines = cloneLines();
    const line = lines.find((l) => l.code === item.code);
    if (line) {
      line.quantity = Math.min(MAX_QUANTITY_PER_LINE, line.quantity + quantity);
    } else {
      lines.push({ code: item.code, name: item.name, price: item.price, quantity, addedAt: Date.now() });
    }
    commit(lines);
    return () => commit(before);
  }

  function setQuantity(code, quantity) {
    const lines = cloneLines();
    const line = lines.find((l) => l.code === code);
    if (!line) return;
    line.quantity = Math.max(1, Math.min(MAX_QUANTITY_PER_LINE, quantity));
    commit(lines);
  }

  function remove(code) {
    const before = cloneLines();
    commit(cloneLines().filter((l) => l.code !== code));
    return () => commit(before);
  }

  // 今回の記録を消去し、「よく頼む」の履歴に移す。取り消すと履歴も元に戻る
  function clear() {
    const before = cloneLines();
    const historyBefore = Object.assign({}, history);
    before.forEach((line) => {
      history[line.code] = (history[line.code] || 0) + line.quantity;
    });
    commit([]);
    return () => {
      history = historyBefore;
      commit(before);
    };
  }

  // 過去の来店分と今回の注文を合わせた品ごとの注文数（コード→数量）
  function frequencies() {
    const counts = Object.assign({}, history);
    state.lines.forEach((line) => {
      counts[line.code] = (counts[line.code] || 0) + line.quantity;
    });
    return counts;
  }

  function subscribe(listener) {
    listeners.push(listener);
  }

  load();

  global.OrderStore = {
    MAX_QUANTITY_PER_LINE,
    getSnapshot,
    quantityOf,
    add,
    setQuantity,
    remove,
    clear,
    frequencies,
    subscribe,
  };
})(window);
