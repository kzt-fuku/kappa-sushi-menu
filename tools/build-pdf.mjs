// docs/data/menu.json から印刷用 PDF（A4 縦・2 ページ）を生成し、レイアウトを検証する。
//   cd tools && npm run pdf
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startServer } from "./static-server.mjs";
import { launchOptions } from "./browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "docs", "kappa-sushi-price-list.pdf");
const LAYOUT_TIMEOUT_MS = 30_000;
const ALIGN_TOLERANCE_PX = 0.5;

// 各段で価格の右端が揃い、すべての行が段・ページの内側に収まり、品名と価格が重ならないことを確認する
function inspectLayout() {
  const problems = [];
  document.querySelectorAll(".page").forEach((page, pageIndex) => {
    const pageRect = page.getBoundingClientRect();
    page.querySelectorAll(".col").forEach((column, columnIndex) => {
      const label = `p${pageIndex + 1}-${columnIndex === 0 ? "左" : "右"}`;
      const colRect = column.getBoundingClientRect();
      const priceRights = new Set();
      column.querySelectorAll(".row").forEach((row) => {
        const rowRect = row.getBoundingClientRect();
        const name = row.querySelector(".name-cell").getBoundingClientRect();
        const price = row.querySelector(".price").getBoundingClientRect();
        priceRights.add(Math.round(price.right * 2) / 2);
        if (rowRect.bottom > colRect.bottom + 0.5 || rowRect.bottom > pageRect.bottom) {
          problems.push(`${label}: ${row.dataset.name} が段からはみ出し`);
        }
        if (name.right > price.left + 0.5) problems.push(`${label}: ${row.dataset.name} の品名と価格が重なる`);
        if (rowRect.right > colRect.right + 0.5) problems.push(`${label}: ${row.dataset.name} が横にはみ出し`);
      });
      if (priceRights.size > 1) problems.push(`${label}: 価格の右端が ${[...priceRights].join(", ")} でずれている`);
    });
  });
  return problems;
}

async function main() {
  const server = await startServer(ROOT);
  const browser = await puppeteer.launch(launchOptions());
  try {
    const page = await browser.newPage();
    page.on("console", (message) => console.log(`[print] ${message.text()}`));
    await page.goto(`${server.origin}/tools/print/print.html`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.printLayout, { timeout: LAYOUT_TIMEOUT_MS });
    const result = await page.evaluate(() => window.printLayout);
    if (result.error) throw new Error(result.error);

    const placed = result.columns.flat();
    const problems = await page.evaluate(inspectLayout);
    if (result.unplaced.length) problems.push(`収まらなかった品: ${result.unplaced.join(", ")}`);
    if (placed.length !== result.total) problems.push(`掲載数 ${placed.length} / 全 ${result.total} 品`);
    if (new Set(placed).size !== placed.length) problems.push("重複して掲載された品がある");

    console.log(`一覧の文字サイズ ${result.fontSizePt}pt、段ごとの行数: ${result.columns.map((c) => c.length).join(" / ")}（計 ${placed.length} 品）`);
    if (problems.length) {
      problems.forEach((p) => console.error("NG:", p));
      process.exitCode = 1;
      return;
    }

    await page.pdf({ path: OUTPUT, preferCSSPageSize: true, printBackground: true });
    console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
