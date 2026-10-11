// ExcelJS always writes a picture's <xdr:spPr> with this exact static transform
// (see node_modules/exceljs/lib/xlsx/xform/drawing/sp-pr.js) and drops any rotation
// that existed on the original artwork. The 갑지 결재 도장 is slightly rotated in the
// source stamp image, so we patch the rotation back into the already-written buffer.
const BLANK_XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>';
const STAMP_XFRM = '<a:xfrm rot="262130"><a:off x="3505363" y="8254535"/><a:ext cx="529434" cy="710203"/></a:xfrm>';

type Zip = import("jszip");

function extractSelfClosingTags(xml: string, tagName: string) {
  return xml.match(new RegExp("<" + tagName + "\\b[^>]*/>", "g")) ?? [];
}

function extractAttr(tag: string, attr: string) {
  const match = tag.match(new RegExp(attr + '="([^"]*)"'));
  return match ? match[1] : null;
}

async function findSheetPart(zip: Zip, sheetName: string) {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const workbookRels = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
  if (!workbookXml || !workbookRels) return null;

  const sheetTag = extractSelfClosingTags(workbookXml, "sheet").find((tag) => extractAttr(tag, "name") === sheetName);
  const sheetRid = sheetTag && extractAttr(sheetTag, "r:id");
  if (!sheetRid) return null;

  const relTag = extractSelfClosingTags(workbookRels, "Relationship").find((tag) => extractAttr(tag, "Id") === sheetRid);
  const target = relTag && extractAttr(relTag, "Target");
  return target ? "xl/" + target.replace(/^\.?\//, "") : null;
}

async function findDrawingPart(zip: Zip, sheetPart: string) {
  const sheetDir = sheetPart.slice(0, sheetPart.lastIndexOf("/"));
  const sheetFile = sheetPart.slice(sheetPart.lastIndexOf("/") + 1);
  const relsPath = sheetDir + "/_rels/" + sheetFile + ".rels";
  const relsXml = await zip.file(relsPath)?.async("text");
  if (!relsXml) return null;

  const drawingRel = extractSelfClosingTags(relsXml, "Relationship").find((tag) =>
    (extractAttr(tag, "Type") ?? "").endsWith("/drawing"),
  );
  const target = drawingRel && extractAttr(drawingRel, "Target");
  if (!target) return null;

  const parts = (sheetDir + "/" + target).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  return resolved.join("/");
}

export async function restoreGapjiStampRotation(buffer: Uint8Array): Promise<Uint8Array> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const sheetPart = await findSheetPart(zip, "갑지");
    if (!sheetPart) return buffer;
    const drawingPart = await findDrawingPart(zip, sheetPart);
    if (!drawingPart) return buffer;

    const drawingXml = await zip.file(drawingPart)?.async("text");
    if (!drawingXml || !drawingXml.includes(BLANK_XFRM)) return buffer;

    zip.file(drawingPart, drawingXml.replace(BLANK_XFRM, STAMP_XFRM));
    return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  } catch {
    return buffer;
  }
}
