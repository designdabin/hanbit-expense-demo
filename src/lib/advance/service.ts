// 원본의 /api/expense/{match-card,preview,download} 라우트를 브라우저 함수 호출로 옮긴 것.
import { getDownloadFilename, createAdvanceWorkbook, summarizeRows } from "./generator";
import { parseApprovalWorkbook, type ParsedApprovalRows } from "./parser";
import type { ApprovalRow, CorporateCard, PreviewResponse } from "./types";

export class StatementError extends Error {
  reason?: "invalid-statement";
  constructor(message: string, reason?: "invalid-statement") {
    super(message);
    this.reason = reason;
  }
}

export type CardMatch = { card: CorporateCard; source: "statement-card-number" | "file-name"; message: string; parsed: ParsedApprovalRows };

const INVALID_STATEMENT = "카드 사용내역 파일이 아닌 것으로 보여요. 결제일, 사용처, 결제 금액이 들어 있는 파일을 업로드해 주세요.";

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/\.[^.]+$/, "").replace(/[\s_\-()[\].]/g, "");
}

function findCardByFileName(fileNameText: string, cards: CorporateCard[]) {
  const normalized = normalizeMatchText(fileNameText);
  const scored = cards.map((card) => {
    const hasLast4 = normalized.includes(card.last4);
    const hasCompany = normalized.includes(card.cardCompany.toLowerCase());
    const hasHolder = normalized.includes(normalizeMatchText(card.holderName));
    let score = 0;
    if (hasLast4) score += 4;
    if (hasHolder) score += 3;
    if (hasCompany) score += 2;
    return { card, score, hasLast4, hasHolder, hasCompany };
  }).filter((result) => result.score > 0);

  const bestScore = Math.max(0, ...scored.map((result) => result.score));
  const best = scored.filter((result) => result.score === bestScore);
  if (best.length !== 1) return null;

  const match = best[0];
  if (match.hasLast4 || (match.hasHolder && match.hasCompany)) return match.card;
  return null;
}

function getCardLast4(cardNumber: string | undefined) {
  const digits = String(cardNumber ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function statementLast4s(parsed: ParsedApprovalRows) {
  return Array.from(new Set([...parsed.rows, ...parsed.cancelledRows].map((row) => getCardLast4(row.cardNumber)).filter(Boolean)));
}

/** 승인내역서를 읽고 카드번호(없으면 파일명)로 등록 카드를 자동 식별한다. */
export async function matchCard(fileName: string, data: ArrayBuffer | Uint8Array, cards: CorporateCard[]): Promise<CardMatch> {
  const parsed = await parseApprovalWorkbook(data);
  if (parsed.rows.length === 0 && parsed.cancelledRows.length === 0) throw new StatementError(INVALID_STATEMENT, "invalid-statement");

  const last4Values = statementLast4s(parsed);
  if (last4Values.length > 0) {
    const matchedCards = cards.filter((card) => last4Values.includes(card.last4));
    if (last4Values.length === 1 && matchedCards.length === 1) {
      const card = matchedCards[0];
      return { card, source: "statement-card-number", parsed, message: "파일 속 카드번호로 확인했어요." };
    }
    if (matchedCards.length === 0) {
      throw new StatementError("파일 속 카드번호 ****" + last4Values.join(", ****") + "와 같은 등록 카드가 없어요. 카드를 등록하거나 사용한 카드를 직접 선택해 주세요.");
    }
    throw new StatementError("파일에 카드번호가 여러 개 있어 자동으로 찾을 수 없어요. 사용한 카드를 직접 선택해 주세요.");
  }

  const byName = findCardByFileName(fileName, cards);
  if (byName) {
    return { card: byName, source: "file-name", parsed, message: "파일 이름으로 확인했어요." };
  }
  throw new StatementError("파일에서 카드를 찾지 못했어요. 사용한 카드를 직접 선택해 주세요.");
}

/** 선택한 카드와 승인내역서가 일치하는지 검증하고 미리보기 데이터를 만든다. */
export async function buildPreview(card: CorporateCard, data: ArrayBuffer | Uint8Array, parsedInput?: ParsedApprovalRows): Promise<PreviewResponse> {
  const parsed = parsedInput ?? await parseApprovalWorkbook(data);
  if (parsed.rows.length === 0 && parsed.cancelledRows.length === 0) throw new StatementError(INVALID_STATEMENT, "invalid-statement");

  const last4Values = statementLast4s(parsed);
  if (last4Values.some((last4) => last4 !== card.last4)) {
    throw new StatementError("선택한 카드(****" + card.last4 + ")가 파일 속 카드(****" + last4Values.join(", ****") + ")와 달라요. 카드를 다시 확인해 주세요.");
  }
  const month = (parsed.rows[0] ?? parsed.cancelledRows[0])?.approvalDate.slice(5, 7) ?? "00";
  return { card, month, rows: parsed.rows, cancelledRows: parsed.cancelledRows, totals: summarizeRows(parsed.rows), warnings: parsed.warnings };
}

/** 경비 정산서 xlsx를 만들어 브라우저 다운로드를 시작한다. */
export async function downloadWorkbook(card: CorporateCard, rows: ApprovalRow[]) {
  if (!rows.length) throw new StatementError("내려받을 사용내역이 없어요.");
  const output = await createAdvanceWorkbook({ card, rows });
  const blob = new Blob([output as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getDownloadFilename(card, rows);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
