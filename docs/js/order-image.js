// 注文リストを PNG 画像にする（Canvas に直接描画。外部ライブラリは使わない）。
(function (global) {
  "use strict";

  const WIDTH = 1080; // 画像の幅（px）。スマホの写真アプリで見やすい幅
  const PADDING = 64;
  const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
  const COLORS = { text: "#1d1d1f", muted: "#6b6b70", accent: "#b3122a", line: "#e3e3e6", band: "#f6f6f7" };
  const SIZE = { title: 52, meta: 30, name: 38, unit: 30, total: 64, note: 26 };
  const LINE_GAP = 12;
  const ROW_PADDING = 26;
  const SUBTOTAL_WIDTH = 240;
  const NOTE_LINES = ["店内飲食・税込の通常価格で計算した目安です。", "店舗によって価格が異なる場合があります。"];
  const NOTE_LINE_GAP = 16;

  function font(size, weight) {
    return `${weight || 400} ${size}px ${FONT_FAMILY}`;
  }

  function yen(value) {
    return `${value.toLocaleString("ja-JP")}円`;
  }

  // 日本語は単語区切りがないため、1 文字ずつ幅を測って折り返す
  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let current = "";
    for (const ch of Array.from(text)) {
      if (current && ctx.measureText(current + ch).width > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // 描画内容を組み立てる（高さを先に求めるため、描画とレイアウトを分ける）
  function layout(ctx, snapshot) {
    const nameWidth = WIDTH - PADDING * 2 - SUBTOTAL_WIDTH;
    ctx.font = font(SIZE.name, 700);
    return snapshot.lines.map((line) => {
      const nameLines = wrapText(ctx, line.name, nameWidth);
      const height = ROW_PADDING * 2 + nameLines.length * (SIZE.name + LINE_GAP) + SIZE.unit;
      return { line, nameLines, height };
    });
  }

  function formatStamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${pad(date.getMinutes())}`;
  }

  // snapshot: OrderStore.getSnapshot()、options: { version, now }
  function render(snapshot, options) {
    const now = options.now || new Date();
    const measure = document.createElement("canvas").getContext("2d");
    const rows = layout(measure, snapshot);

    const headerHeight = PADDING + SIZE.title + 20 + SIZE.meta + 40;
    const totalHeight = 40 + SIZE.total + 40;
    const footerHeight = 40 + (NOTE_LINES.length + 1) * (SIZE.note + NOTE_LINE_GAP) + PADDING;
    const height = headerHeight + totalHeight + rows.reduce((sum, row) => sum + row.height, 0) + footerHeight;

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = Math.ceil(height);
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, WIDTH, canvas.height);
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(0, 0, WIDTH, 12);

    let y = PADDING;
    ctx.fillStyle = COLORS.text;
    ctx.font = font(SIZE.title, 800);
    ctx.fillText("かっぱ寿司 注文リスト", PADDING, y);
    y += SIZE.title + 20;
    ctx.fillStyle = COLORS.muted;
    ctx.font = font(SIZE.meta);
    ctx.fillText(`${formatStamp(now)} 時点`, PADDING, y);
    y += SIZE.meta + 40;

    // 合計
    ctx.fillStyle = COLORS.band;
    ctx.fillRect(PADDING - 24, y, WIDTH - (PADDING - 24) * 2, totalHeight - 20);
    y += 30;
    // 左に「合計 N皿」、右に金額
    const labelY = y + SIZE.total - SIZE.meta - 6;
    ctx.fillStyle = COLORS.text;
    ctx.font = font(SIZE.meta, 700);
    ctx.fillText("合計", PADDING, labelY);
    const labelWidth = ctx.measureText("合計").width;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`${snapshot.totalQuantity}皿`, PADDING + labelWidth + 20, labelY);
    ctx.fillStyle = COLORS.text;
    ctx.font = font(SIZE.total, 800);
    ctx.textAlign = "right";
    ctx.fillText(yen(snapshot.totalPrice), WIDTH - PADDING, y);
    ctx.textAlign = "left";
    y += totalHeight - 30;

    // 明細
    rows.forEach(({ line, nameLines, height: rowHeight }) => {
      let rowY = y + ROW_PADDING;
      ctx.fillStyle = COLORS.text;
      ctx.font = font(SIZE.name, 700);
      nameLines.forEach((text) => {
        ctx.fillText(text, PADDING, rowY);
        rowY += SIZE.name + LINE_GAP;
      });
      ctx.fillStyle = COLORS.muted;
      ctx.font = font(SIZE.unit);
      ctx.fillText(`${yen(line.price)} × ${line.quantity}`, PADDING, rowY);

      ctx.fillStyle = COLORS.text;
      ctx.font = font(SIZE.name, 700);
      ctx.textAlign = "right";
      ctx.fillText(yen(line.price * line.quantity), WIDTH - PADDING, y + ROW_PADDING);
      ctx.textAlign = "left";

      y += rowHeight;
      ctx.fillStyle = COLORS.line;
      ctx.fillRect(PADDING, y - 2, WIDTH - PADDING * 2, 2);
    });

    // 注記
    y += 40;
    ctx.fillStyle = COLORS.muted;
    ctx.font = font(SIZE.note);
    NOTE_LINES.forEach((text) => {
      ctx.fillText(text, PADDING, y);
      y += SIZE.note + NOTE_LINE_GAP;
    });
    ctx.fillText(`かっぱ寿司 通常価格一覧 v${options.version}（非公式）`, PADDING, y);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("画像を作成できませんでした"))), "image/png");
    });
  }

  function fileName(now) {
    const pad = (n) => String(n).padStart(2, "0");
    return `kappa-order-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.png`;
  }

  // iPhone などでは共有シート（「画像を保存」で写真に保存）、それ以外はダウンロード
  async function save(snapshot, options) {
    const now = new Date();
    const blob = await render(snapshot, Object.assign({}, options, { now }));
    const name = fileName(now);
    const file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
    const isTouchDevice = navigator.maxTouchPoints > 0;
    if (file && isTouchDevice && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return "shared";
      } catch (error) {
        if (error && error.name === "AbortError") return "cancelled"; // 共有シートを閉じただけ
        console.warn("share failed, fallback to download:", error);
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return "downloaded";
  }

  global.OrderImage = { render, save };
})(window);
