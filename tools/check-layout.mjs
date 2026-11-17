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
      rank: row.querySelector(".rank").textContent,
      price: row.querySelector(".price").textContent,
    };
  });
  if (priceRights.size > 1) problems.push(`価格の右端がずれている: ${[...priceRights].join(", ")}`);
  const pressed = document.querySelector('.genre-button[aria-pressed="true"]');
  return { problems, items, pressed: pressed && pressed.textContent, status: document.getElementById("status").textContent };
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
      const page = await browser.newPage();
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
      console.log(`${width}px: 全て ${all.items.length} 品、ジャンル ${data.genres.length} 種を確認`);
      await page.close();
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
