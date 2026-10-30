// 원본 vitest(parser/routes)를 node:test 로 옮긴 회귀 테스트 + 데모 샘플/양식 검증.
// 실행: node --import ./scripts/advance/register.mjs --test scripts/advance/advance.test.mts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { parseApprovalWorkbook } from "../../src/lib/advance/parser.ts";
import { SEED_CARDS } from "../../src/lib/advance/cards.ts";
import { createAdvanceWorkbook, getDownloadFilename } from "../../src/lib/advance/generator.ts";
import { parseSettlementFile } from "../../src/lib/audit/settlementParser.ts";
import { SHEET_NAME } from "../../src/lib/settlement/form.ts";
import { buildPreview, matchCard, StatementError } from "../../src/lib/advance/service.ts";
import type { ApprovalRow } from "../../src/lib/advance/types.ts";

const SAMPLES = path.join(import.meta.dirname, "..", "..", "public", "samples");
const HEADERS = ["승인일", "가맹점명", "승인금액", "카드번호", "승인번호", "사업자등록번호", "업종명", "상태", "취소금액", "취소일자"];
const [KIM, LEE, HONG, PARK] = SEED_CARDS;

type Cell = string | number | null;
const book = (rows: Cell[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }));
};
const FIXTURES = path.join(import.meta.dirname, "..", "fixtures");
// 화면용 샘플은 public/samples, 나머지는 scripts/fixtures
const sample = (name: string) => new Uint8Array(readFileSync(existsSync(path.join(SAMPLES, name)) ? path.join(SAMPLES, name) : path.join(FIXTURES, name)));

// ---- parser (원본 tests/parser.test.ts) ----
test("정확한 가맹점명 헤더를 부분 일치 헤더보다 우선한다", async () => {
  const parsed = await parseApprovalWorkbook(book([
    ["승인일", "가맹점전화번호", "가맹점명", "승인금액", "카드번호", "승인번호"],
    ["2026-03-04", "02-1234-5678", "정상가맹점", 55000, "1111-2222-3333-9911", "A-1"],
  ]));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].merchant, "정상가맹점");
});

test("승인번호가 같은 취소건이 있으면 원거래를 제외한다", async () => {
  const parsed = await parseApprovalWorkbook(book([
    HEADERS,
    ["2026-03-04", "테스트식당", 30000, "1111-2222-3333-9911", "APPROVAL-1", "111-22-33333", "식당", "정상", "", ""],
    ["2026-03-05", "테스트식당", -30000, "1111-2222-3333-9911", "APPROVAL-1", "111-22-33333", "식당", "승인취소", "", ""],
    ["2026-03-06", "남은건", 8000, "1111-2222-3333-9911", "APPROVAL-2", "111-22-33333", "택배", "정상", "", ""],
  ]));
  assert.deepEqual(parsed.rows.map((r) => r.merchant), ["남은건"]);
  assert.deepEqual(parsed.cancelledRows.map((r) => r.merchant), ["테스트식당"]);
});

test("카드번호·가맹점·금액·취소일자로도 원거래를 제외한다", async () => {
  const parsed = await parseApprovalWorkbook(book([
    HEADERS,
    ["2026-03-04", "테스트문구점", 12000, "1111-2222-3333-9911", "", "111-22-33333", "사무용품", "정상", "", ""],
    ["2026-03-06", "테스트문구점", -12000, "1111-2222-3333-9911", "", "111-22-33333", "사무용품", "취소", "", "2026-03-04"],
    ["2026-03-07", "유지건", 5000, "1111-2222-3333-9911", "", "111-22-33333", "소모품", "정상", "", ""],
  ]));
  assert.deepEqual(parsed.rows.map((r) => r.merchant), ["유지건"]);
  assert.deepEqual(parsed.cancelledRows.map((r) => r.merchant), ["테스트문구점"]);
});

test("헤더 없는 시트는 7열 구조로 읽고 경고한다", async () => {
  const parsed = await parseApprovalWorkbook(book([["2026-03-04", "1111-2222-3333-9911", "헤더없음상점", 44000, "NO-HEADER-1", "", "111-22-33333"]]));
  assert.equal(parsed.rows.length, 1);
  assert.ok(parsed.warnings.some((w) => w.startsWith("제목 줄이 없는 파일이라 기업카드 기본 열 순서로 읽었어요.")));
});

// ---- match-card / preview (원본 tests/routes.test.ts) ----
test("승인내역서의 카드번호로 카드를 자동 식별한다", async () => {
  const m = await matchCard("statement.xlsx", book([HEADERS, ["2026-03-04", "테스트주유소", 55000, "9411-****-****-4471", "A1001", "111-22-33333", "주유소", "정상", "", ""]]), SEED_CARDS);
  assert.equal(m.source, "statement-card-number");
  assert.equal(m.card.id, KIM.id);
});

test("카드번호가 없으면 파일명으로 식별한다", async () => {
  const m = await matchCard("김철수_국민_4471.xlsx", book([HEADERS, ["2026-03-04", "테스트문구점", 12000, "", "A1002", "222-33-44444", "사무용품", "정상", "", ""]]), SEED_CARDS);
  assert.equal(m.source, "file-name");
  assert.equal(m.card.id, KIM.id);
});

test("쓸 수 없는 파일은 invalid-statement 로 거절한다", async () => {
  await assert.rejects(matchCard("invalid.xlsx", book([["이상한열1", "이상한열2", "이상한열3"], ["foo", "bar", "baz"]]), SEED_CARDS), (e: unknown) => e instanceof StatementError && e.reason === "invalid-statement");
});

test("선택 카드와 승인내역서 카드번호가 다르면 미리보기를 막는다", async () => {
  const data = book([HEADERS, ["2026-03-04", "테스트주유소", 55000, "9411-****-****-4471", "A1001", "111-22-33333", "주유소", "정상", "", ""]]);
  await assert.rejects(buildPreview(LEE, data), /파일 속 카드\(.*\)와 달라요/);
});

// ---- 데모 샘플 ----
test("샘플 4종이 시드 카드로 자동 매칭되고 기대 건수를 낸다", async () => {
  const expected: Array<[string, string, number, number]> = [
    // 파일, 카드, 승인 행수, 취소 행수
    ["법인카드_승인내역_국민카드_2026년03월_김철수.xlsx", KIM.id, 18, 0],
    ["법인카드_승인내역_기업카드_2026년03월_이영희.xlsx", LEE.id, 10, 0],
    ["법인카드_승인내역_국민카드_2026년03월_홍길동.xlsx", HONG.id, 30, 3],
    ["법인카드_승인내역_기업카드_2026년04월_박민수.xlsx", PARK.id, 36, 0],
  ];
  for (const [file, cardId, rows, cancelled] of expected) {
    const m = await matchCard(file, sample(file), SEED_CARDS);
    assert.equal(m.card.id, cardId, file);
    const preview = await buildPreview(m.card, sample(file), m.parsed);
    assert.equal(preview.rows.length, rows, file);
    assert.equal(preview.cancelledRows.length, cancelled, file);
  }
});

test("취소 샘플: 승인취소 3건이 승인번호로 짝을 이뤄 원거래를 제외한다", async () => {
  const parsed = await parseApprovalWorkbook(sample("법인카드_승인내역_국민카드_2026년03월_홍길동.xlsx"));
  assert.equal(parsed.cancelledRows.length, 3);
  for (const no of ["C7003", "C7005", "C7023"]) {
    assert.ok(!parsed.rows.some((r) => r.approvalNumber === no), "승인번호 매칭 취소 " + no);
  }
  assert.equal(parsed.rows.length, 30);
});

test("헤더 없는 샘플은 경고를 낸다", async () => {
  const parsed = await parseApprovalWorkbook(sample("법인카드_승인내역_기업카드_2026년03월_이영희.xlsx"));
  assert.ok(parsed.warnings.some((w) => w.startsWith("제목 줄이 없는")));
});

// ---- 생성기 / 양식 ----
function row(id: string, date: string, merchant: string, amount: number, key: ApprovalRow["categoryKey"], name: string, col: ApprovalRow["categoryColumn"]): ApprovalRow {
  return { id, approvalDate: date, merchant, amount, cardNumber: "9411-****-****-4471", industry: "", status: "정상", categoryKey: key, categoryName: name, categoryColumn: col };
}

async function load(buf: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

test("생성 결과: 시트 하나에 요약·내역·합계 수식이 채워진다", async () => {
  const rows = [
    row("1", "2026-03-04", "가람 주유소", 55000, "fuel", "주유비", "I"),
    row("2", "2026-03-04", "온누리 문구", 12000, "supplies", "물품구입비", "K"),
    row("3", "2026-03-05", "행복 커피", 8000, "welfare", "복리후생비", "H"),
  ];
  const out = await createAdvanceWorkbook({ card: KIM, rows });
  assert.equal(getDownloadFilename(KIM, rows), "경비정산서_03월분_김철수.xlsx");

  const wb = await load(out);
  assert.deepEqual(wb.worksheets.map((w) => w.name), [SHEET_NAME]);
  const sheet = wb.worksheets[0];
  // 요약(라벨 → 값)
  assert.equal(sheet.getCell("B4").value, "2026-03-01 ~ 2026-03-31");
  assert.equal(sheet.getCell("E3").value, KIM.holderName);
  assert.equal(sheet.getCell("E4").value, "(국민카드) ****-****-****-4471");
  // 내역: 머리글 8행, 데이터 9~11행, 합계 12행
  assert.equal(sheet.getCell("A8").value, "날짜");
  assert.equal((sheet.getCell("A9").value as Date).toISOString(), "2026-03-04T00:00:00.000Z");
  assert.equal(sheet.getCell("B9").value, "가람 주유소");
  assert.equal(sheet.getCell("C9").value, 55000);
  assert.equal(sheet.getCell("D9").value, "법인카드");
  assert.equal(sheet.getCell("E9").value, "주유비");
  assert.ok(!sheet.getCell("F9").value, "사용 목적은 비워 둔다");
  assert.equal(sheet.getCell("A12").value, "합계");
  const sum = sheet.getCell("C12").value as { formula: string; result: number };
  assert.equal(sum.formula, "SUM(C9:C11)");
  assert.equal(sum.result, 75000);
  assert.equal((sheet.getCell("B5").value as { formula: string }).formula, 'SUMIF(D9:D11,"법인카드",C9:C11)');
});

test("만든 정산서를 규정 확인 파서가 그대로 다시 읽는다(두 기능의 양식이 같다)", async () => {
  const parsed = await parseApprovalWorkbook(sample("법인카드_승인내역_국민카드_2026년03월_홍길동.xlsx"));
  const out = await createAdvanceWorkbook({ card: HONG, rows: parsed.rows });
  const file = parseSettlementFile(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, getDownloadFilename(HONG, parsed.rows));
  assert.equal(file.ownerName, HONG.holderName);
  assert.equal(file.usagePeriod, "2026-03-01 ~ 2026-03-31");
  assert.equal(file.cardNumber, "(국민카드) ****-****-****-3159");
  assert.equal(file.rows.length, parsed.rows.length);
  assert.deepEqual(file.rows.map((r) => r.amount), parsed.rows.map((r) => r.amount));
  assert.deepEqual(file.rows.map((r) => r.merchant), parsed.rows.map((r) => r.merchant));
  assert.ok(file.rows.every((r) => r.paymentMethod === "법인카드" && r.note === ""));
  assert.equal(file.personalCardTotal, 0);
});

test("36건 샘플로 생성해도 합계 SUM 범위가 따라간다", async () => {
  const parsed = await parseApprovalWorkbook(sample("법인카드_승인내역_기업카드_2026년04월_박민수.xlsx"));
  assert.equal(parsed.rows.length, 36);
  const out = await createAdvanceWorkbook({ card: PARK, rows: parsed.rows });
  const sheet = (await load(out)).worksheets[0];
  const totalRow = 8 + 36 + 1; // 머리글 8, 데이터 9..44, 합계 45
  assert.equal(sheet.getCell("A" + totalRow).value, "합계");
  assert.equal((sheet.getCell("C" + totalRow).value as { formula: string }).formula, `SUM(C9:C${totalRow - 1})`);
  assert.equal(sheet.getCell("C" + (totalRow - 1)).value, parsed.rows[35].amount);
});
