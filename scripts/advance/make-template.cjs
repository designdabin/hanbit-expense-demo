// 사내 양식(원본)을 받아 회사명·인명·도장·연락처를 가상 값으로 치환한 일반 양식을 만든다.
// 사용법: node scripts/advance/make-template.cjs <원본 xlsx 경로> <치환규칙.json>
// 출력:   public/samples/advance-template.xlsx
// 원본은 저장소에 포함하지 않는다. 결과물에 금칙어가 남으면 실패한다.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

const src = process.argv[2];
if (!src || !process.argv[3]) throw new Error("usage: node make-template.cjs <source.xlsx> <replacements.json>");
const OUT = path.join(__dirname, "..", "..", "public", "samples", "advance-template.xlsx");

// 치환 규칙은 저장소 밖 JSON([[정규식 문자열, 치환값], ...])으로 받는다. 실명·사명을 코드에 남기지 않기 위함.
// 순서 중요(이메일이 회사명보다 먼저). 각 정규식은 결과물 검사(금칙어)에도 재사용된다.
const REPLACEMENTS = JSON.parse(fs.readFileSync(process.argv[3], "utf8")).map(([re, to]) => [new RegExp(re, "gi"), to]);
const FORBIDDEN = new RegExp(REPLACEMENTS.map(([re]) => re.source).join("|"), "i");

const fix = (text) => REPLACEMENTS.reduce((t, [re, to]) => t.replace(re, to), text);

// --- 가상 도장(붉은 타원 + 십자) PNG, 원본과 같은 종횡비(약 0.745) ---
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function fakeStampPng() {
  const w = 149, h = 200, cx = w / 2, cy = h / 2, rx = 68, ry = 93;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x += 1) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const ring = (d >= 0.92 && d <= 1) || (d >= 0.74 && d <= 0.78);
      const cross = d < 0.6 && (Math.abs(x - cx) < 3 || Math.abs(y - cy) < 3 || Math.abs(y - cy - 28) < 3 || Math.abs(y - cy + 28) < 3);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      if (ring || cross) { raw[o] = 178; raw[o + 1] = 34; raw[o + 2] = 34; raw[o + 3] = 225; }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  const srcBuf = fs.readFileSync(src);
  const srcZip = await JSZip.loadAsync(srcBuf);
  const stampBytes = await srcZip.file("xl/media/image2.png").async("nodebuffer");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(srcBuf);
  wb.creator = "한빛건설";
  wb.lastModifiedBy = "한빛건설";

  for (const ws of wb.worksheets) {
    for (const key of Object.keys(ws.headerFooter || {})) {
      if (typeof ws.headerFooter[key] === "string") ws.headerFooter[key] = fix(ws.headerFooter[key]);
    }
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.master && cell.master.address !== cell.address) return;
        const v = cell.value;
        if (typeof v === "string") cell.value = fix(v);
        else if (v && Array.isArray(v.richText)) v.richText.forEach((seg) => { seg.text = fix(seg.text); });
      });
    });
  }
  wb.getWorksheet("차량운행 일지").getCell("G12").note = "리터당 유류대는 영수증을 중심으로 작성 요망";

  const out = Buffer.from(await wb.xlsx.writeBuffer());
  const zip = await JSZip.loadAsync(out);
  let swapped = 0;
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/media\/.+\.png$/i.test(name)) continue;
    if ((await zip.file(name).async("nodebuffer")).equals(stampBytes)) { zip.file(name, fakeStampPng()); swapped += 1; }
  }
  if (swapped !== 1) throw new Error("stamp image not found in output (swapped=" + swapped + ")");

  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || !/\.(xml|rels|vml)$/i.test(name)) continue;
    const text = await zip.file(name).async("text");
    const hit = text.match(FORBIDDEN);
    if (hit) throw new Error("forbidden text '" + hit[0] + "' remains in " + name);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log("wrote", path.relative(process.cwd(), OUT), "(stamp swapped, scan clean)");
})();
