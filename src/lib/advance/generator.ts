import { buildSettlementWorkbook } from "../settlement/form";
import { EXPENSE_CATEGORIES } from "./categories";
import type { ApprovalRow, CorporateCard } from "./types";

function monthFromRows(rows: ApprovalRow[]) {
  const date = rows[0]?.approvalDate;
  if (!date) return "00";
  return date.slice(5, 7);
}

/** "2026-04-01 ~ 2026-04-30" */
function periodOf(rows: ApprovalRow[]) {
  const first = rows[0]?.approvalDate;
  if (!first) return "";
  const year = Number(first.slice(0, 4));
  const month = Number(first.slice(5, 7));
  const lastDay = new Date(year, month, 0).getDate();
  const ym = first.slice(0, 7);
  return ym + "-01 ~ " + ym + "-" + String(lastDay).padStart(2, "0");
}

/**
 * 카드 사용내역으로 경비 정산서(xlsx)를 만든다.
 * 날짜·사용처·금액·결제수단·항목과 위쪽 요약을 채우고, 사용 목적은 사용자가 적도록 비워 둔다.
 */
export async function createAdvanceWorkbook(options: {
  card: CorporateCard;
  rows: ApprovalRow[];
}): Promise<Uint8Array> {
  const { card, rows } = options;
  return buildSettlementWorkbook({
    department: card.department ?? "",
    owner: card.holderName,
    period: periodOf(rows),
    card: "(" + card.cardCompany + "카드) ****-****-****-" + card.last4,
    lines: rows.map((row) => ({
      date: row.approvalDate,
      merchant: row.merchant,
      amount: row.amount,
      payment: "법인카드" as const,
      item: row.categoryName,
      note: "",
    })),
  });
}

export function getDownloadFilename(card: CorporateCard, rows: ApprovalRow[]) {
  const month = monthFromRows(rows);
  return "경비정산서_" + month + "월분_" + card.holderName + ".xlsx";
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
