import type ExcelJS from "exceljs";
import { EXPENSE_CATEGORIES } from "./categories";
import { restoreGapjiStampRotation } from "./stamp";
import type { ApprovalRow, CorporateCard } from "./types";

const DATA_START_ROW = 8;
export const TEMPLATE_URL = "/samples/advance-template.xlsx";
const DATA_ROW_MERGES = [
  ["B", "D"],
  ["N", "O"],
  ["P", "S"],
  ["T", "U"],
] as const;
const DATE_GROUP_BASE_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFFFFFFF" },
};
const ALTERNATING_DATE_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFE5E7EB" },
};

function cloneStyle<T>(value: T): T {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function findLabelRow(sheet: ExcelJS.Worksheet, label: string, fallback: number) {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const value = String(sheet.getCell(rowNumber, 1).value ?? "").replace(/\s/g, "");
    if (value.includes(label.replace(/\s/g, ""))) return rowNumber;
  }
  return fallback;
}

function monthFromRows(rows: ApprovalRow[]) {
  const date = rows[0]?.approvalDate;
  if (!date) return "00";
  return date.slice(5, 7);
}

function endOfMonth(dateText: string) {
  const year = Number(dateText.slice(0, 4));
  const month = Number(dateText.slice(5, 7));
  return new Date(year, month, 0).getDate();
}

function toExcelDate(dateText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function nextMonthDate(dateText: string, day: number) {
  const year = Number(dateText.slice(0, 4));
  const month = Number(dateText.slice(5, 7));
  return new Date(Date.UTC(year, month, day));
}

function setMergedValue(sheet: ExcelJS.Worksheet, address: string, value: string | number | Date | null) {
  sheet.getCell(address).value = value;
}

function ensureMerge(sheet: ExcelJS.Worksheet, range: string) {
  try {
    sheet.mergeCells(range);
  } catch {
    // Existing merged ranges are expected in the template.
  }
}

function columnToNumber(column: string) {
  return column.split("").reduce((total, char) => total * 26 + char.toUpperCase().charCodeAt(0) - 64, 0);
}

function rangeToBounds(range: string) {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    left: columnToNumber(match[1]),
    top: Number(match[2]),
    right: columnToNumber(match[3]),
    bottom: Number(match[4]),
  };
}

function rangesOverlap(first: string, second: string) {
  const a = rangeToBounds(first);
  const b = rangeToBounds(second);
  if (!a || !b) return false;
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function resetMerge(sheet: ExcelJS.Worksheet, range: string) {
  const existingMerges = [...(sheet.model.merges ?? [])];
  for (const mergedRange of existingMerges) {
    if (!rangesOverlap(mergedRange, range)) continue;
    try {
      sheet.unMergeCells(mergedRange);
    } catch {
      // Ignore stale merge metadata from row insertions.
    }
  }
  try {
    sheet.mergeCells(range);
  } catch {
    // If ExcelJS still sees the target as merged, keep generating the workbook.
  }
}

function normalizeDataRowMerges(sheet: ExcelJS.Worksheet, totalRow: number) {
  for (let rowNumber = DATA_START_ROW; rowNumber < totalRow; rowNumber += 1) {
    for (const [from, to] of DATA_ROW_MERGES) {
      resetMerge(sheet, from + rowNumber + ":" + to + rowNumber);
    }
  }
}

function prepareRows(sheet: ExcelJS.Worksheet, rowCount: number) {
  let totalRow = findLabelRow(sheet, "합계", 39);
  const capacity = totalRow - DATA_START_ROW;
  if (rowCount > capacity) {
    const toAdd = rowCount - capacity;
    sheet.insertRows(totalRow, Array.from({ length: toAdd }, () => []), "i");
    totalRow += toAdd;
    const source = sheet.getRow(DATA_START_ROW);
    for (let rowNumber = totalRow - toAdd; rowNumber < totalRow; rowNumber += 1) {
      const target = sheet.getRow(rowNumber);
      target.height = source.height;
      for (let col = 1; col <= 21; col += 1) {
        target.getCell(col).style = cloneStyle(source.getCell(col).style);
      }
      ensureMerge(sheet, "B" + rowNumber + ":D" + rowNumber);
      ensureMerge(sheet, "N" + rowNumber + ":O" + rowNumber);
      ensureMerge(sheet, "P" + rowNumber + ":S" + rowNumber);
      ensureMerge(sheet, "T" + rowNumber + ":U" + rowNumber);
    }
  }
  return totalRow;
}

function clearDataArea(sheet: ExcelJS.Worksheet, totalRow: number) {
  for (let rowNumber = DATA_START_ROW; rowNumber < totalRow; rowNumber += 1) {
    for (const col of [1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 20]) {
      sheet.getCell(rowNumber, col).value = null;
    }
  }
}

function applyAlternatingDateGroupFills(sheet: ExcelJS.Worksheet, rows: ApprovalRow[]) {
  const dateGroupIndexes = new Map<string, number>();

  rows.forEach((row, index) => {
    const groupIndex = dateGroupIndexes.get(row.approvalDate) ?? dateGroupIndexes.size;
    dateGroupIndexes.set(row.approvalDate, groupIndex);
    const rowNumber = DATA_START_ROW + index;
    for (let column = 1; column <= 21; column += 1) {
      const cell = sheet.getCell(rowNumber, column);
      cell.style = cloneStyle(cell.style);
      cell.fill = cloneStyle(groupIndex % 2 === 0 ? DATE_GROUP_BASE_FILL : ALTERNATING_DATE_FILL);
    }
  });
}

function applyFormulas(workbook: ExcelJS.Workbook, totalRow: number) {
  const eulji = workbook.getWorksheet("을지");
  const gapji = workbook.getWorksheet("갑지");
  if (!eulji) throw new Error("정산서 양식에서 사용 내역 시트('을지')를 찾지 못했습니다.");
  const dataEnd = totalRow - 1;
  for (const col of ["E", "F", "G", "H", "I", "J", "K", "L", "M"]) {
    eulji.getCell(col + totalRow).value = { formula: "SUM(" + col + DATA_START_ROW + ":" + col + dataEnd + ")" };
  }

  const regulationRow = findLabelRow(eulji, "경비규정", totalRow + 2);
  for (let row = regulationRow + 1; row <= Math.min(regulationRow + 7, eulji.rowCount); row += 1) {
    for (const col of ["H", "I", "J", "K", "L", "M"]) {
      eulji.getCell(col + row).value = { formula: "SUMIF(B" + DATA_START_ROW + ":D" + dataEnd + ",E" + row + "," + col + DATA_START_ROW + ":" + col + dataEnd + ")" };
    }
    eulji.getCell("N" + row).value = { formula: "SUM(H" + row + ":M" + row + ")" };
  }

  if (gapji) {
    gapji.getCell("G18").value = { formula: "'을지'!H" + totalRow };
    gapji.getCell("G19").value = { formula: "'을지'!I" + totalRow };
    gapji.getCell("G20").value = { formula: "'을지'!J" + totalRow };
    gapji.getCell("G21").value = { formula: "'을지'!K" + totalRow };
    gapji.getCell("G22").value = { formula: "'을지'!L" + totalRow };
    gapji.getCell("G23").value = { formula: "'을지'!M" + totalRow };
  }
}

async function fetchTemplate() {
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) throw new Error("정산서 양식 파일을 불러오지 못했습니다.");
  return response.arrayBuffer();
}

export async function createAdvanceWorkbook(options: {
  card: CorporateCard;
  rows: ApprovalRow[];
  templateBuffer?: ArrayBuffer | Uint8Array;
}): Promise<Uint8Array> {
  const ExcelJSModule = await import("exceljs");
  const workbook = new (ExcelJSModule.default ?? ExcelJSModule).Workbook();
  const source = options.templateBuffer ?? await fetchTemplate();
  await (workbook.xlsx.load as (data: unknown) => Promise<ExcelJS.Workbook>)(source);
  const sheet = workbook.getWorksheet("을지");
  if (!sheet) throw new Error("정산서 양식에서 사용 내역 시트('을지')를 찾지 못했습니다.");

  const rows = options.rows;
  const month = monthFromRows(rows);
  const totalRow = prepareRows(sheet, rows.length);
  normalizeDataRowMerges(sheet, totalRow);
  clearDataArea(sheet, totalRow);
  applyAlternatingDateGroupFills(sheet, rows);

  rows.forEach((row, index) => {
    const rowNumber = DATA_START_ROW + index;
    sheet.getCell("A" + rowNumber).value = toExcelDate(row.approvalDate);
    sheet.getCell("A" + rowNumber).numFmt = "yyyy-mm-dd";
    sheet.getCell("E" + rowNumber).value = row.amount;
    sheet.getCell("E" + rowNumber).numFmt = "#,##0";
    setMergedValue(sheet, "N" + rowNumber, row.merchant);
    setMergedValue(sheet, "B" + rowNumber, null);
    setMergedValue(sheet, "P" + rowNumber, null);
    setMergedValue(sheet, "T" + rowNumber, null);
  });

  sheet.getCell("A1").value = "Expense Report  ( " + month + "월 )";
  applyFormulas(workbook, totalRow);

  const gapji = workbook.getWorksheet("갑지");
  if (gapji) {
    const first = rows[0]?.approvalDate ?? "2025-" + month + "-01";
    const year = first.slice(0, 4);
    gapji.getCell("G8").value = year + ". " + month + ". 01 ~" + month + ". " + String(endOfMonth(first)).padStart(2, "0");
    gapji.getCell("G9").value = "(" + options.card.cardCompany + "카드) ****-****-****-" + options.card.last4;
    gapji.getCell("G5").value = options.card.department ?? "";
    gapji.getCell("O5").value = options.card.holderName;

    const applicationDate = nextMonthDate(first, 5);
    gapji.getCell("W5").value = applicationDate;
    gapji.getCell("W5").numFmt = 'mm"월" dd"일"';

    const decisionDate = nextMonthDate(first, 10);
    gapji.getCell("A30").value = decisionDate;
    gapji.getCell("A30").numFmt = "yyyy. mm. dd";
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return restoreGapjiStampRotation(new Uint8Array(buffer as ArrayBuffer));
}

export function getDownloadFilename(card: CorporateCard, rows: ApprovalRow[]) {
  const month = monthFromRows(rows);
  return "전도금 신청서_" + month + "월분_" + card.holderName + "_법인카드.xlsx";
}

export function summarizeRows(rows: ApprovalRow[]) {
  const totals = {
    welfare: 0,
    fuel: 0,
    travel: 0,
    supplies: 0,
    delivery: 0,
    etc: 0,
    all: 0,
  };
  for (const row of rows) {
    totals[row.categoryKey] += row.amount;
    totals.all += row.amount;
  }
  return totals;
}

export { EXPENSE_CATEGORIES };
