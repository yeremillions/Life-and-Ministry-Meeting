import fs from "fs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

async function run() {
  const file = "test.pdf";
  const buf = fs.readFileSync(file);
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items;
    console.log("Page", i, "items:", items.slice(0, 50).map(it => it.str));
    break;
  }
}
run();
