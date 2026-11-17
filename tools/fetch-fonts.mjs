// 印刷用 PDF に埋め込む Noto Sans JP（SIL Open Font License）の静的 TrueType を取得する。
// Chrome の PDF 出力は CFF(OTF)・可変フォントを Type 3 で埋め込むため、静的 TTF を使う。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
const CSS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700";
const WEIGHT_FILES = { 400: "NotoSansJP-Regular.ttf", 700: "NotoSansJP-Bold.ttf" };

async function main() {
  // woff2 非対応の UA を名乗ると、Google Fonts は分割なしの TTF を返す
  const css = await (await fetch(CSS_URL, { headers: { "User-Agent": "curl/8" } })).text();
  const faces = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+\.ttf)\)/g)];
  await mkdir(FONT_DIR, { recursive: true });
  for (const [, weight, url] of faces) {
    const file = WEIGHT_FILES[weight];
    if (!file) continue;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await writeFile(path.join(FONT_DIR, file), Buffer.from(await response.arrayBuffer()));
    console.log(`saved fonts/${file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
