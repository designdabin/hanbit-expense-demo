import { EXPENSE_CATEGORIES, recommendCategory } from "./categories";
import type { ApprovalRow, ExpenseCategoryKey } from "./types";

const HEADER_ALIASES = {
  approvalDate: ["승인일", "승인일자", "이용일", "사용일", "거래일", "매출일", "승인일시"],
  merchant: ["가맹점명", "사용처", "이용가맹점", "거래처", "가맹점", "상호"],
  amount: ["승인금액", "이용금액", "사용금액", "금액", "매출금액"],
  cardNumber: ["카드번호", "카드 번호"],
  approvalNumber: ["승인번호", "승인 번호"],
  businessNumber: ["사업자등록번호", "사업자번호", "사업장 번호"],
  industry: ["업종명", "업종", "가맹점업종"],
  status: ["상태", "승인상태", "거래상태", "취소여부", "승인구분"],
  cancelledAmount: ["취소금액", "취소 금액"],
  cancelledDate: ["취소일자", "취소 일자"],
};

type RawRow = Array<string | number | Date | null | undefined>;
type ColumnMap = Partial<Record<keyof typeof HEADER_ALIASES, number>>;
export type ParsedApprovalRows = { rows: ApprovalRow[]; cancelledRows: ApprovalRow[]; warnings: string[] };
type ParsedApprovalRow = ApprovalRow & { _cancelledAmount?: number | null; _cancelledDate?: string };
type CancellationCandidate = { row: ParsedApprovalRow; consumed: boolean };
type HeaderMatch = { score: number; aliasIndex: number };
type XlsxModule = typeof import("xlsx");

function normalizeHeader(value: unknown) {
  return String(value ?? "").replace(/[\s\n\r]/g, "").trim();
}

function matchHeaderScore(header: string, alias: string) {
  const normalizedAlias = alias.replace(/\s/g, "");
  if (header === normalizedAlias) return 3;
  if (header.startsWith(normalizedAlias)) return 2;
  if (header.includes(normalizedAlias)) return 1;
  return 0;
}

function bestHeaderMatch(header: string, aliases: string[]): HeaderMatch {
  return aliases.reduce<HeaderMatch>((best, alias, aliasIndex) => {
    const score = matchHeaderScore(header, alias);
    if (score > best.score) return { score, aliasIndex };
    if (score === best.score && score > 0 && aliasIndex < best.aliasIndex) return { score, aliasIndex };
    return best;
  }, { score: 0, aliasIndex: Number.MAX_SAFE_INTEGER });
}

function findHeaderMap(rows: RawRow[]): { headerRow: number; map: ColumnMap } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    const row = rows[rowIndex];
    const map: ColumnMap = {};
    const matches: Partial<Record<keyof typeof HEADER_ALIASES, HeaderMatch>> = {};
    row.forEach((cell, index) => {
      const normalized = normalizeHeader(cell);
      for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[keyof typeof HEADER_ALIASES, string[]]>) {
        const match = bestHeaderMatch(normalized, aliases);
        const current = matches[field] ?? { score: 0, aliasIndex: Number.MAX_SAFE_INTEGER };
        if (match.score > current.score || (match.score === current.score && match.aliasIndex < current.aliasIndex)) {
          map[field] = index;
          matches[field] = match;
        }
      }
    });
    if (map.approvalDate !== undefined && map.merchant !== undefined && map.amount !== undefined) {
      return { headerRow: rowIndex, map };
    }
  }
  return null;
}

function inferHeaderlessMap(rows: RawRow[]): ColumnMap {
  const firstDataRow = rows.find((row) => row.some(Boolean)) ?? [];
  const amountIndex = firstDataRow.findIndex((cell) => typeof cell === "number" || /^-?[\d,]+$/.test(String(cell ?? "")));
  return {
    approvalDate: 0,
    cardNumber: 1,
    merchant: 2,
    amount: amountIndex >= 0 ? amountIndex : 3,
    approvalNumber: 4,
    businessNumber: 6,
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateString(XLSX: XlsxModule, value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return String(parsed.y) + "-" + String(parsed.m).padStart(2, "0") + "-" + String(parsed.d).padStart(2, "0");
  }
  const text = String(value ?? "").trim();
  const match = text.match(/(20\d{2})[-.\/]?\s*(\d{1,2})[-.\/]?\s*(\d{1,2})/);
  if (!match) return null;
  return match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
}

function get(row: RawRow, index: number | undefined) {
  return index === undefined ? "" : row[index];
}

function makeId(date: string, merchant: string, amount: number, index: number) {
  return (date + "-" + merchant + "-" + amount + "-" + index).replace(/[^a-zA-Z0-9가-힣-]/g, "");
}

function isCancelledStatus(status: string) {
  const normalized = status.replace(/\s/g, "").toLowerCase();
  return normalized.includes("취소") || normalized.includes("cancel");
}

function isCancelledRow(row: ApprovalRow, cancelledAmount: number | null, cancelledDate: string) {
  return isCancelledStatus(row.status ?? "") || row.amount < 0 || (cancelledAmount !== null && cancelledAmount > 0) || cancelledDate.length > 0;
}

function sortRows(rows: ApprovalRow[]) {
  return rows.sort((a, b) => a.approvalDate.localeCompare(b.approvalDate) || a.merchant.localeCompare(b.merchant));
}

function normalizeMatchText(value: string | undefined) {
  return String(value ?? "").replace(/\s/g, "").trim();
}

function cancellationMatchKey(XLSX: XlsxModule, row: ApprovalRow, cancelledDate?: string) {
  return [
    normalizeMatchText(row.cardNumber),
    normalizeMatchText(row.merchant),
    Math.abs(row.amount),
    toDateString(XLSX, cancelledDate) ?? cancelledDate ?? row.approvalDate,
  ].join("|");
}

function consumeMatchingCancellation(XLSX: XlsxModule, cancellations: CancellationCandidate[], row: ParsedApprovalRow) {
  if (row.approvalNumber) {
    const approvalNumberMatch = cancellations.find((candidate) => {
      return !candidate.consumed && candidate.row.approvalNumber === row.approvalNumber;
    });
    if (approvalNumberMatch) {
      approvalNumberMatch.consumed = true;
      return true;
    }
  }

  const rowKey = cancellationMatchKey(XLSX, row);
  const detailMatch = cancellations.find((candidate) => {
    return !candidate.consumed && cancellationMatchKey(XLSX, candidate.row, candidate.row._cancelledDate) === rowKey;
  });
  if (detailMatch) {
    detailMatch.consumed = true;
    return true;
  }
  return false;
}

/** 카드 승인내역서(xlsx)를 읽어 승인건/취소건으로 나눈다. 브라우저·Node 공용. */
export async function parseApprovalWorkbook(data: ArrayBuffer | Uint8Array): Promise<ParsedApprovalRows> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array", cellDates: true, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<RawRow>(sheet, { header: 1, defval: "", raw: false });
  const header = findHeaderMap(rawRows);
  const map = header?.map ?? inferHeaderlessMap(rawRows);
  const start = header ? header.headerRow + 1 : 0;
  const warnings: string[] = [];

  const parsedRows = rawRows.slice(start).map((row, index) => {
    const approvalDate = toDateString(XLSX, get(row, map.approvalDate));
    const merchant = String(get(row, map.merchant) ?? "").trim();
    const amount = toNumber(get(row, map.amount));
    if (!approvalDate || !merchant || amount === null) return null;

    const industry = String(get(row, map.industry) ?? "").trim();
    const cancelledAmount = toNumber(get(row, map.cancelledAmount));
    const cancelledDate = toDateString(XLSX, get(row, map.cancelledDate)) ?? String(get(row, map.cancelledDate) ?? "").trim();
    const categoryKey = recommendCategory(industry + " " + merchant);
    const category = EXPENSE_CATEGORIES[categoryKey];

    return {
      id: makeId(approvalDate, merchant, amount, index),
      approvalDate,
      merchant,
      amount,
      cardNumber: String(get(row, map.cardNumber) ?? "").trim() || undefined,
      approvalNumber: String(get(row, map.approvalNumber) ?? "").trim() || undefined,
      businessNumber: String(get(row, map.businessNumber) ?? "").trim() || undefined,
      industry: industry || undefined,
      status: String(get(row, map.status) ?? "").trim() || (cancelledAmount !== null && cancelledAmount > 0 ? "취소" : undefined),
      categoryKey,
      categoryName: category.name,
      categoryColumn: category.column,
      _cancelledAmount: cancelledAmount,
      _cancelledDate: cancelledDate,
    } satisfies ParsedApprovalRow;
  }).filter(Boolean) as ParsedApprovalRow[];

  const cancelledRows = parsedRows.filter((row) => isCancelledRow(row, row._cancelledAmount ?? null, row._cancelledDate ?? ""));
  const cancellationCandidates = cancelledRows.map((row) => ({ row, consumed: false }));
  const rows = parsedRows.filter((row) => {
    if (cancelledRows.includes(row)) return false;
    if (consumeMatchingCancellation(XLSX, cancellationCandidates, row)) return false;
    return true;
  });

  const sorted = sortRows(rows.map(({ _cancelledAmount, _cancelledDate, ...row }) => row));
  const sortedCancelledRows = sortRows(cancelledRows.map(({ _cancelledAmount, _cancelledDate, ...row }) => row));
  if (!header) warnings.push("제목 줄이 없는 파일이라 기업카드 기본 열 순서로 읽었어요. 금액이 이상하면 파일을 확인해 주세요.");
  if (sorted.length === 0 && sortedCancelledRows.length === 0) warnings.push("사용내역을 찾지 못했어요. 결제일, 사용처, 결제 금액 열이 있는지 확인해 주세요.");
  return { rows: sorted, cancelledRows: sortedCancelledRows, warnings };
}

export function withCategory(row: ApprovalRow, categoryKey: ExpenseCategoryKey): ApprovalRow {
  const category = EXPENSE_CATEGORIES[categoryKey];
  return { ...row, categoryKey, categoryName: category.name, categoryColumn: category.column };
}
