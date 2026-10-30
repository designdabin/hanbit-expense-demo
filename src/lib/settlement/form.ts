/**
 * 경비 정산서 양식(가상). 정산서 자동 작성(advance)이 만들고 경비 규정 준수 확인(audit)이 읽는 파일의 모양을
 * 이 한 곳에서 정의한다. 시트는 하나이고, 위쪽은 `라벨 → 값` 요약, 아래쪽은 내역 표다.
 *
 *   경비 정산서
 *   소속 ○○       담당자 ○○
 *   사용 기간 …    카드번호 …
 *   법인카드 합계  개인카드 합계
 *   현금 합계      전체 합계
 *
 *   날짜 | 사용처 | 금액 | 결제수단 | 항목 | 사용 목적
 *   …
 *   합계 |        | ○○
 *
 * 읽는 쪽(src/lib/audit/settlementParser.ts)은 열 번호가 아니라 아래 머리글·라벨 이름으로 찾는다.
 * 프레임워크·DOM 의존 없이 node 에서도 그대로 돌아간다(샘플 생성 스크립트가 쓴다).
 */

export const SHEET_NAME = "경비 정산서";

/** 내역 표 머리글(왼쪽부터 순서대로). 파서도 같은 이름으로 열을 찾는다. */
export const HEADERS = {
  date: "날짜",
  merchant: "사용처",
  amount: "금액",
  payment: "결제수단",
  item: "항목",
  note: "사용 목적",
} as const;

/** 위쪽 요약의 라벨. 값은 라벨 오른쪽 셀에 있다. */
export const LABELS = {
  department: "소속",
  owner: "담당자",
  period: "사용 기간",
  card: "카드번호",
  corporate: "법인카드 합계",
  personal: "개인카드 합계",
  cash: "현금 합계",
  total: "전체 합계",
} as const;

export const TOTAL_LABEL = "합계";

export type PaymentMethod = "법인카드" | "개인카드" | "현금";

/** 내역 한 줄. null 은 빈 줄(날짜 사이를 띄울 때) */
export interface SettlementLine {
  /** "2026-04-15" */
  date: string;
  merchant: string;
  amount: number;
  payment: PaymentMethod;
  /** 항목(식비·주유비 같은 분류). 없으면 빈 문자열 */
  item: string;
  /** 사용 목적. 자동 작성은 비워 두고 사용자가 적는다 */
  note: string;
}

export interface SettlementInput {
  department: string;
  owner: string;
  /** "2026-04-01 ~ 2026-04-30" */
  period: string;
  /** "(국민카드) ****-****-****-3159" */
  card: string;
  lines: Array<SettlementLine | null>;
  /** 제목 위에 비워 둘 줄 수(머리글이 첫 줄에 없는 파일도 읽히는지 확인하는 용도) */
  topPadding?: number;
}

/** 요약 위치와 표 시작 줄(제목 줄 기준 상대값) */
const ROW = { title: 0, owner: 2, period: 3, corporate: 4, cash: 5, header: 7 } as const;
const COLUMN_WIDTHS = [13, 26, 14, 12, 14, 38];
const LINE = { style: "thin" as const, color: { argb: "FF6B7280" } };
const BOX = { top: LINE, bottom: LINE, left: LINE, right: LINE };
const LABEL_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE5E7EB" } };
const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFD1D5DB" } };

function toExcelDate(text: string) {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** 경비 정산서 xlsx 를 새로 만든다. 양식 파일 없이 코드로 그린다. */
export async function buildSettlementWorkbook(input: SettlementInput): Promise<Uint8Array> {
  const ExcelJSModule = await import("exceljs");
  const workbook = new (ExcelJSModule.default ?? ExcelJSModule).Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);
  COLUMN_WIDTHS.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });

  const pad = input.topPadding ?? 0;
  const at = (offset: number) => pad + offset + 1; // 엑셀 줄 번호(1부터)

  sheet.getCell("A" + at(ROW.title)).value = "경비 정산서";
  sheet.getCell("A" + at(ROW.title)).font = { bold: true, size: 16 };

  // 위쪽 요약: 라벨(회색 칸) 오른쪽에 값 칸. 오른쪽 짝의 값은 E:F 를 합쳐 긴 값(카드번호)이 칸 안에 들어가게 한다.
  const summary = (row: number, labelColumn: "A" | "D", label: string, value: string | number | { formula: string; result: number }) => {
    const valueColumn = labelColumn === "A" ? "B" : "E";
    const labelCell = sheet.getCell(labelColumn + row);
    labelCell.value = label;
    labelCell.font = { bold: true };
    labelCell.fill = LABEL_FILL;
    labelCell.alignment = { vertical: "middle", horizontal: "left" };
    labelCell.border = BOX;
    const valueCell = sheet.getCell(valueColumn + row);
    valueCell.value = value;
    valueCell.alignment = { vertical: "middle", horizontal: "left" };
    valueCell.border = BOX;
    if (typeof value !== "string") valueCell.numFmt = "#,##0";
    if (labelColumn === "D") {
      sheet.getCell("F" + row).border = BOX;
      sheet.mergeCells(`E${row}:F${row}`);
    }
  };

  // 내역 표
  const headerRow = at(ROW.header);
  Object.values(HEADERS).forEach((text, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    cell.value = text;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = BOX;
  });

  let rowNumber = headerRow;
  const totals: Record<PaymentMethod, number> = { 법인카드: 0, 개인카드: 0, 현금: 0 };
  for (const line of input.lines) {
    rowNumber += 1;
    // 빈 줄도 칸과 테두리를 그려 표가 끊겨 보이지 않게 한다
    const values = line ? [toExcelDate(line.date), line.merchant, line.amount, line.payment, line.item, line.note] : [null, null, null, null, null, null];
    values.forEach((value, index) => {
      const cell = sheet.getCell(rowNumber, index + 1);
      cell.value = value;
      cell.border = BOX;
      cell.alignment = { vertical: "middle", horizontal: index === 2 ? "right" : index === 0 || index === 3 ? "center" : "left" };
    });
    if (!line) continue;
    sheet.getCell("A" + rowNumber).numFmt = "yyyy-mm-dd";
    sheet.getCell("C" + rowNumber).numFmt = "#,##0";
    totals[line.payment] += line.amount;
  }

  // 합계 줄과 위쪽 요약(수식에 계산 결과도 함께 넣어 두어, 수식을 계산하지 않는 프로그램도 값을 읽게 한다)
  const first = headerRow + 1;
  const last = rowNumber;
  const totalRow = last + 1;
  const all = totals.법인카드 + totals.개인카드 + totals.현금;
  for (let column = 1; column <= 6; column += 1) {
    const cell = sheet.getCell(totalRow, column);
    cell.font = { bold: true };
    cell.fill = LABEL_FILL;
    cell.border = BOX;
    cell.alignment = { vertical: "middle", horizontal: column === 3 ? "right" : "left" };
  }
  sheet.getCell("A" + totalRow).value = TOTAL_LABEL;
  sheet.getCell("C" + totalRow).value = { formula: `SUM(C${first}:C${last})`, result: all };
  sheet.getCell("C" + totalRow).numFmt = "#,##0";

  const sumif = (method: PaymentMethod) => ({ formula: `SUMIF(D${first}:D${last},"${method}",C${first}:C${last})`, result: totals[method] });
  summary(at(ROW.owner), "A", LABELS.department, input.department);
  summary(at(ROW.owner), "D", LABELS.owner, input.owner);
  summary(at(ROW.period), "A", LABELS.period, input.period);
  summary(at(ROW.period), "D", LABELS.card, input.card);
  summary(at(ROW.corporate), "A", LABELS.corporate, sumif("법인카드"));
  summary(at(ROW.corporate), "D", LABELS.personal, sumif("개인카드"));
  summary(at(ROW.cash), "A", LABELS.cash, sumif("현금"));
  summary(at(ROW.cash), "D", LABELS.total, { formula: `C${totalRow}`, result: all });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
