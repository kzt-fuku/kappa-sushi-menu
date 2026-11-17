// Web ページの表示確認（iPhone 相当の 375px / 390px 幅）。
//   node check-layout.mjs                     … ローカルの docs/ を確認
//   node check-layout.mjs <公開 URL>          … 公開された GitHub Pages を確認
// スクリーンショットは SCREENSHOT_DIR（既定: OS の一時ディレクトリ）に保存する。
import os from "node:os";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startServer } from "./static-server.mjs";
import { launchOptions } from "./browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWPORT_WIDTHS = [375, 390];
const VIEWPORT_HEIGHT = 844;
const DEVICE_SCALE_FACTOR = 3;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "kappa-sushi-menu-check");
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// ページ内で表示中の一覧を検査する
function inspectList() {
  const problems = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth) problems.push(`横スクロールあり (${doc.scrollWidth}px > ${window.innerWidth}px)`);

  const rows = Array.from(document.querySelectorAll(".menu-row"));
  const priceRights = new Set();
  const items = rows.map((row) => {
    const name = row.querySelector(".name-cell").getBoundingClientRect();
    const price = row.querySelector(".price").getBoundingClientRect();
    const title = row.querySelector(".name").textContent;
    priceRights.add(Math.round(price.right * 2) / 2);
    if (name.right > price.left + 0.5) problems.push(`${title}: 品名と価格が重なる`);
    if (price.right > window.innerWidth) problems.push(`${title}: 価格が画面外`);
    return {
      name: title,
      rank: row.querySelector(".rank-num").textContent,
      price: row.querySelector(".price").textContent,
    };
  });
  if (priceRights.size > 1) problems.push(`価格の右端がずれている: ${[...priceRights].join(", ")}`);
  const pressed = document.querySelector('.genre-button[aria-pressed="true"]');
  return { problems, items, pressed: pressed && pressed.textContent, status: document.getElementById("status").textContent };
}

// 注文の記録機能を一通り操作し、合計が正しく計算・保存されることを確認する
async function checkOrdering(page, data, width, problems) {
  const label = `${width}px 注文`;
  const fail = (message) => problems.push(`${label}: ${message}`);
  const priceOf = (name) => data.items.find((i) => i.name === name).price;
  const yen = (value) => `${value.toLocaleString("ja-JP")}円`;
  const text = (selector) => page.$eval(selector, (el) => el.textContent.trim());
  const click = (selector) => page.$eval(selector, (el) => el.click());
  const clickRow = (name) =>
    page.evaluate((n) => {
      const row = Array.from(document.querySelectorAll("button.menu-row")).find((r) => r.querySelector(".name").textContent === n);
      row.click();
    }, name);
  const expectTotal = async (price, count, step) => {
    const total = await text("#bar-total");
    const plates = await text("#bar-count");
    if (total !== yen(price) || plates !== `${count}皿`) fail(`${step}: 合計 ${total} ${plates}（期待 ${yen(price)} ${count}皿）`);
  };
  const isOpen = (selector) => page.$eval(selector, (el) => el.open);

  await page.evaluate(() => Array.from(document.querySelectorAll(".genre-button")).find((b) => b.textContent === "全て").click());
  await expectTotal(0, 0, "初期");

  // 価格なしの品は押せない
  const unpricedButtons = await page.$$eval("button.menu-row", (rows) => rows.filter((r) => r.textContent.includes("—")).length);
  if (unpricedButtons) fail("価格なしの品が押せる");

  // 中とろを 3 つ注文
  await clickRow("中とろ");
  if (!(await isOpen("#quantity-sheet"))) fail("メニューを押しても数量選択が開かない");
  await click("#quantity-plus");
  await click("#quantity-plus");
  const orderLabel = await text("#quantity-order");
  if (await text("#quantity-value") !== "3" || !orderLabel.includes(yen(priceOf("中とろ") * 3))) fail(`数量選択の表示: ${orderLabel}`);
  const sheetOverflow = await page.$eval("#quantity-sheet", (el) => el.scrollWidth > el.clientWidth);
  if (sheetOverflow) fail("数量選択が横にはみ出す");
  const layout = await page.evaluate(() => {
    const stepper = document.querySelector("#quantity-sheet .stepper").getBoundingClientRect();
    const order = document.getElementById("quantity-order").getBoundingClientRect();
    return { sameRow: Math.abs(stepper.top - order.top) < 2 && order.left >= stepper.right };
  });
  if (!layout.sameRow) fail("注文ボタンが数量の横にない");
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-quantity.png`) });
  await click("#quantity-order");
  if (await isOpen("#quantity-sheet")) fail("注文後に数量選択が閉じない");
  let expected = priceOf("中とろ") * 3;
  await expectTotal(expected, 3, "中とろ×3");
  const badge = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("button.menu-row")).find((r) => r.querySelector(".name").textContent === "中とろ");
    return row.querySelector(".ordered-badge").textContent;
  });
  if (badge !== "×3") fail(`一覧の注文済み表示: ${badge}`);

  // サーモンを追加して取り消す
  await clickRow("サーモン");
  await click("#quantity-order");
  await expectTotal(expected + priceOf("サーモン"), 4, "サーモン追加");
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-toast.png`) });
  await click("#toast-undo");
  await expectTotal(expected, 3, "取り消し");

  // 北海道祭りプレートを追加し、注文リストで数量変更・削除・元に戻す
  await clickRow("北海道祭り5貫プレート（単品）");
  await click("#quantity-order");
  expected += priceOf("北海道祭り5貫プレート（単品）");
  await expectTotal(expected, 4, "プレート追加");
  await click("#open-order-list");
  if (!(await isOpen("#order-sheet"))) fail("注文リストが開かない");
  const lines = await page.$$eval(".order-line", (els) => els.map((el) => el.querySelector(".order-line-name").textContent));
  if (lines.join(",") !== "中とろ,北海道祭り5貫プレート（単品）") fail(`注文リストの内容: ${lines.join(",")}`);
  if (await text("#sheet-total") !== yen(expected)) fail(`注文リストの合計: ${await text("#sheet-total")}`);
  await page.$$eval(".order-line", (els) => els[0].querySelectorAll(".stepper-button")[1].click());
  expected += priceOf("中とろ");
  await expectTotal(expected, 5, "リストで＋");
  if (await page.$eval("#order-sheet", (el) => el.scrollWidth > el.clientWidth)) fail("注文リストが横にはみ出す");
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-order-list.png`) });
  await page.$$eval(".order-line", (els) => els[0].querySelector(".remove-button").click());
  await expectTotal(priceOf("北海道祭り5貫プレート（単品）"), 1, "リストで削除");
  const toastInSheet = await page.$eval("#toast", (el) => el.closest("#order-sheet") !== null && !el.hidden);
  if (!toastInSheet) fail("注文リスト表示中に取り消しが表示されない");
  await click("#toast-undo");
  await expectTotal(expected, 5, "削除の取り消し");
  await page.$eval("#order-sheet [data-close]", (el) => el.click());

  // 再読み込みしても記録が残る
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".menu-row");
  await expectTotal(expected, 5, "再読み込み後");

  // 最後の行が合計バーに隠れない
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const hidden = await page.evaluate(() => {
    const last = Array.from(document.querySelectorAll(".menu-item")).pop().getBoundingClientRect();
    return last.bottom > document.getElementById("order-bar").getBoundingClientRect().top + 0.5;
  });
  if (hidden) fail("最後の行が合計バーに隠れる");
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-bar-bottom.png`) });

  // すべて消去
  await click("#open-order-list");
  await click("#order-clear");
  await expectTotal(0, 0, "すべて消去");
  await page.$eval("#order-sheet [data-close]", (el) => el.click());

  // 前回（1 日前）の記録が残っていたら「新しく始める」を案内する
  await page.evaluate((item) => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    localStorage.setItem("kappa-sushi-order-v1", JSON.stringify({
      version: 1, updatedAt: dayAgo,
      lines: [{ code: item.code, name: item.name, price: item.price, quantity: 2, addedAt: dayAgo }],
    }));
  }, data.items.find((i) => i.name === "まぐろ"));
  await page.reload({ waitUntil: "networkidle0" });
  await expectTotal(priceOf("まぐろ") * 2, 2, "前回の記録");
  if (await page.$eval("#stale-notice", (el) => el.hidden)) fail("前回の記録の案内が出ない");
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-stale.png`) });
  await click("#stale-reset");
  await expectTotal(0, 0, "新しく始める");
}

function priceValue(label) {
  const match = label.replace(/,/g, "").match(/^(\d+)円/);
  return match ? Number(match[1]) : null;
}

function checkOrder(items, problems, label) {
  let previous = Infinity;
  let seenUnpriced = false;
  for (const item of items) {
    const value = priceValue(item.price);
    if (value === null) {
      seenUnpriced = true;
      continue;
    }
    if (seenUnpriced) problems.push(`${label}: 価格なしの品の後に価格ありの品がある`);
    if (value > previous) problems.push(`${label}: ${item.name} が価格の高い順になっていない`);
    previous = value;
  }
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const data = JSON.parse(await readFile(path.join(ROOT, "docs", "data", "menu.json"), "utf8"));
  const server = process.argv[2] ? null : await startServer(path.join(ROOT, "docs"));
  const baseUrl = process.argv[2] || `${server.origin}/`;
  const browser = await puppeteer.launch(launchOptions());
  const problems = [];

  try {
    for (const width of VIEWPORT_WIDTHS) {
      // 注文記録（localStorage）が幅ごとに混ざらないよう、別のコンテキストで開く
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setUserAgent(IPHONE_UA);
      await page.setViewport({ width, height: VIEWPORT_HEIGHT, deviceScaleFactor: DEVICE_SCALE_FACTOR, isMobile: true, hasTouch: true });
      page.on("pageerror", (error) => problems.push(`${width}px: JS エラー ${error.message}`));
      await page.goto(baseUrl, { waitUntil: "networkidle0" });
      await page.waitForSelector(".menu-row");

      // 初期表示（全て）
      const all = await page.evaluate(inspectList);
      const label = `${width}px 全て`;
      all.problems.forEach((p) => problems.push(`${label}: ${p}`));
      if (all.pressed !== "全て") problems.push(`${label}: 初期表示が「全て」ではない (${all.pressed})`);
      if (all.items.length !== data.items.length) problems.push(`${label}: ${all.items.length} 品表示（期待 ${data.items.length}）`);
      if (new Set(all.items.map((i) => i.name)).size !== all.items.length) problems.push(`${label}: 品名が重複`);
      checkOrder(all.items, problems, label);
      if (all.items.map((i) => i.name).join("\n") !== data.items.map((i) => i.name).join("\n")) {
        problems.push(`${label}: 掲載順が menu.json と異なる`);
      }
      const rankByName = new Map(all.items.map((i) => [i.name, i.rank]));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-all-top.png`) });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-all-bottom.png`) });
      await page.evaluate(() => window.scrollTo(0, 0));

      // ジャンル切り替え
      for (const genre of data.genres) {
        await page.evaluate((g) => {
          Array.from(document.querySelectorAll(".genre-button")).find((b) => b.textContent === g).click();
        }, genre);
        const result = await page.evaluate(inspectList);
        const glabel = `${width}px ${genre}`;
        result.problems.forEach((p) => problems.push(`${glabel}: ${p}`));
        const expected = data.items.filter((i) => i.genres.includes(genre)).map((i) => i.name);
        const shown = result.items.map((i) => i.name);
        if (shown.join("\n") !== expected.join("\n")) {
          problems.push(`${glabel}: 表示 ${shown.length} 品 / 期待 ${expected.length} 品、または掲載順が menu.json と異なる`);
        }
        result.items.forEach((i) => {
          if (rankByName.get(i.name) !== i.rank) problems.push(`${glabel}: ${i.name} の順位が全体と異なる`);
        });
        checkOrder(result.items, problems, glabel);
        if (genre === "チーズ・マヨ") {
          await page.screenshot({ path: path.join(SCREENSHOT_DIR, `w${width}-genre.png`) });
        }
      }
      await checkOrdering(page, data, width, problems);
      console.log(`${width}px: 全て ${all.items.length} 品、ジャンル ${data.genres.length} 種、注文の記録を確認`);
      await context.close();
    }

    // 印刷用 PDF へのリンク
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    const pdfHref = await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.includes("印刷用PDF"));
      return link && link.href;
    });
    if (!pdfHref) {
      problems.push("印刷用PDF のリンクがない");
    } else {
      const response = await fetch(pdfHref);
      const type = response.headers.get("content-type") || "";
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok || !type.includes("pdf") || bytes.subarray(0, 5).toString() !== "%PDF-") {
        problems.push(`印刷用PDF を取得できない (${response.status} ${type})`);
      } else {
        console.log(`印刷用PDF: ${pdfHref} (${bytes.length} bytes)`);
      }
    }
  } finally {
    await browser.close();
    if (server) server.close();
  }

  console.log(`スクリーンショット: ${SCREENSHOT_DIR}`);
  if (problems.length) {
    problems.forEach((p) => console.error("NG:", p));
    process.exitCode = 1;
  } else {
    console.log("OK: 問題なし");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
