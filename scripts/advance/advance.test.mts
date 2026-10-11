// 원본 vitest(parser/routes)를 node:test 로 옮긴 회귀 테스트 + 데모 샘플/양식 검증.
// 실행: node --import ./scripts/advance/register.mjs --test scripts/advance/advance.test.mts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { parseApprovalWorkbook } from "../../src/lib/advance/parser.ts";
import { SEED_CARDS } from "../../src/lib/advance/cards.ts";
import { createAdvanceWorkbook, getDownloadFilename } from "../../src/lib/advance/generator.ts";
import { buildPreview, matchCard, StatementError } from "../../src/lib/advance/service.ts";
import type { ApprovalRow } from "../../src/lib/advance/types.ts";

const SAMPLES = path.join(import.meta.dirname, "..", "..", "public", "samples");
const HEADERS = ["승인일", "가맹점명", "승인금액", "카드번호", "승인번호", "사업자등록번호", "업종명", "상태", "취소금액", "취소일자"];
const [LEE, JUNG, OH, HAN] = SEED_CARDS;

type Cell = string | number | null;
const book = (rows: Cell[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }));
};
const FIXTURES = path.join(import.meta.dirname, "..", "fixtures");
// 화면용 샘플은 public/samples, 나머지는 scripts/fixtures
const sample = (name: string) => new Uint8Array(readFileSync(existsSync(path.join(SAMPLES, name)) ? path.join(SAMPLES, name) : path.join(FIXTURES, name)));
const template = () => new Uint8Array(readFileSync(path.join(SAMPLES, "advance-template.xlsx")));

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
  assert.ok(parsed.warnings.includes("제목 줄이 없는 파일이라 기업카드 기본 순서(결제일·카드번호·사용처·금액…)로 읽었습니다."));
});

// ---- match-card / preview (원본 tests/routes.test.ts) ----
test("승인내역서의 카드번호로 카드를 자동 식별한다", async () => {
  const m = await matchCard("statement.xlsx", book([HEADERS, ["2026-03-04", "테스트주유소", 55000, "9411-****-****-4471", "A1001", "111-22-33333", "주유소", "정상", "", ""]]), SEED_CARDS);
  assert.equal(m.source, "statement-card-number");
  assert.equal(m.card.id, LEE.id);
});

test("카드번호가 없으면 파일명으로 식별한다", async () => {
  const m = await matchCard("이서준_국민_4471.xlsx", book([HEADERS, ["2026-03-04", "테스트문구점", 12000, "", "A1002", "222-33-44444", "사무용품", "정상", "", ""]]), SEED_CARDS);
  assert.equal(m.source, "file-name");
  assert.equal(m.card.id, LEE.id);
});

test("쓸 수 없는 파일은 invalid-statement 로 거절한다", async () => {
  await assert.rejects(matchCard("invalid.xlsx", book([["이상한열1", "이상한열2", "이상한열3"], ["foo", "bar", "baz"]]), SEED_CARDS), (e: unknown) => e instanceof StatementError && e.reason === "invalid-statement");
});

test("선택 카드와 승인내역서 카드번호가 다르면 미리보기를 막는다", async () => {
  const data = book([HEADERS, ["2026-03-04", "테스트주유소", 55000, "9411-****-****-4471", "A1001", "111-22-33333", "주유소", "정상", "", ""]]);
  await assert.rejects(buildPreview(JUNG, data), /카드번호가 다릅니다/);
});

// ---- 데모 샘플 ----
test("샘플 4종이 시드 카드로 자동 매칭되고 기대 건수를 낸다", async () => {
  const expected: Array<[string, string, number, number]> = [
    // 파일, 카드, 승인 행수, 취소 행수
    ["법인카드_승인내역_국민카드_2026년03월_이서준.xlsx", LEE.id, 18, 0],
    ["법인카드_승인내역_기업카드_2026년03월_정하윤.xlsx", JUNG.id, 10, 0],
    ["법인카드_승인내역_국민카드_2026년03월_오민재.xlsx", OH.id, 6, 2],
    ["법인카드_승인내역_기업카드_2026년04월_한지우.xlsx", HAN.id, 36, 0],
  ];
  for (const [file, cardId, rows, cancelled] of expected) {
    const m = await matchCard(file, sample(file), SEED_CARDS);
    assert.equal(m.card.id, cardId, file);
    const preview = await buildPreview(m.card, sample(file), m.parsed);
    assert.equal(preview.rows.length, rows, file);
    assert.equal(preview.cancelledRows.length, cancelled, file);
  }
});

test("취소 샘플: 승인번호/상세조건 취소가 각각 원거래를 제외한다", async () => {
  const parsed = await parseApprovalWorkbook(sample("법인카드_승인내역_국민카드_2026년03월_오민재.xlsx"));
  assert.equal(parsed.cancelledRows.length, 2);
  assert.ok(!parsed.rows.some((r) => r.approvalNumber === "C7002"), "승인번호 매칭 취소");
  assert.ok(!parsed.rows.some((r) => r.merchant === "온누리 문구"), "상세조건 매칭 취소");
  assert.equal(parsed.rows.length, 6);
});

test("헤더 없는 샘플은 경고를 낸다", async () => {
  const parsed = await parseApprovalWorkbook(sample("법인카드_승인내역_기업카드_2026년03월_정하윤.xlsx"));
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

test("생성 결과가 다시 열리고 병합·날짜·SUM 수식·갑지 값이 유지된다", async () => {
  const rows = [
    row("1", "2026-03-04", "가람 주유소", 55000, "fuel", "주유비", "I"),
    row("2", "2026-03-04", "온누리 문구", 12000, "supplies", "물품구입비", "K"),
    row("3", "2026-03-05", "행복 커피", 8000, "welfare", "복리후생비", "H"),
  ];
  const out = await createAdvanceWorkbook({ card: LEE, rows, templateBuffer: template() });
  assert.equal(getDownloadFilename(LEE, rows), "전도금 신청서_03월분_이서준_법인카드.xlsx");

  const wb = await load(out);
  const eulji = wb.getWorksheet("을지")!;
  const gapji = wb.getWorksheet("갑지")!;
  const merges = eulji.model.merges;
  for (const r of [8, 9, 10]) for (const [a, b] of [["B", "D"], ["N", "O"], ["P", "S"], ["T", "U"]]) assert.ok(merges.includes(`${a}${r}:${b}${r}`), `${a}${r}:${b}${r}`);
  assert.equal((eulji.getCell("A8").value as Date).toISOString(), "2026-03-04T00:00:00.000Z");
  assert.equal(eulji.getCell("E8").value, 55000);
  assert.equal(eulji.getCell("N8").value, "가람 주유소");
  assert.equal((eulji.getCell("A8").fill as ExcelJS.FillPattern).fgColor?.argb, "FFFFFFFF");
  assert.equal((eulji.getCell("A10").fill as ExcelJS.FillPattern).fgColor?.argb, "FFE5E7EB");
  const sum = eulji.getCell("E39").value as { formula?: string; sharedFormula?: string };
  assert.ok(sum.formula === "SUM(E8:E38)" || sum.sharedFormula, "합계 SUM 수식");
  assert.equal((eulji.getCell("H39").value as { formula: string }).formula, "SUM(H8:H38)");
  assert.equal(gapji.getCell("G9").value, "(국민카드) ****-****-****-4471");
  assert.equal(gapji.getCell("G5").value, LEE.department);
  assert.equal(gapji.getCell("O5").value, LEE.holderName);
  assert.equal((gapji.getCell("W5").value as Date).toISOString(), "2026-04-05T00:00:00.000Z");
  assert.equal((gapji.getCell("A30").value as Date).toISOString(), "2026-04-10T00:00:00.000Z");
  assert.equal(gapji.getImages().length, 1);

  const zip = await JSZip.loadAsync(out);
  const drawings = await Promise.all(Object.keys(zip.files).filter((n) => /^xl\/drawings\/drawing\d+\.xml$/.test(n)).map((n) => zip.file(n)!.async("text")));
  assert.ok(drawings.some((x) => x.includes('rot="262130"')), "도장 회전 복원");
});

test("36건 샘플로 생성하면 행이 추가되고 합계 SUM 범위가 따라간다", async () => {
  const parsed = await parseApprovalWorkbook(sample("법인카드_승인내역_기업카드_2026년04월_한지우.xlsx"));
  assert.equal(parsed.rows.length, 36);
  const out = await createAdvanceWorkbook({ card: HAN, rows: parsed.rows, templateBuffer: template() });
  const eulji = (await load(out)).getWorksheet("을지")!;
  const totalRow = 8 + 36; // 데이터 8..43, 합계 44
  assert.equal(String(eulji.getCell("A" + totalRow).value).replace(/\s/g, ""), "합계");
  const f = eulji.getCell("E" + totalRow).value as { formula?: string; sharedFormula?: string };
  assert.ok(f.formula === `SUM(E8:E${totalRow - 1})` || f.sharedFormula, JSON.stringify(f));
  assert.equal((eulji.getCell("H" + totalRow).value as { formula: string }).formula, `SUM(H8:H${totalRow - 1})`);
  for (const r of [8, 30, 43]) assert.ok(eulji.model.merges.includes(`N${r}:O${r}`), "N" + r);
  assert.equal(eulji.getCell("E43").value, parsed.rows[35].amount);
  const gapji = (await load(out)).getWorksheet("갑지")!;
  assert.equal((gapji.getCell("G18").value as { formula: string }).formula, "'을지'!H" + totalRow);
});

test("양식에 원본 사명·인명이 남아 있지 않다(금칙어는 make-template 이 검사)", async () => {
  const zip = await JSZip.loadAsync(template());
  const wb = await load(template());
  assert.equal(wb.getWorksheet("갑지")!.getCell("A2").value, "한빛건설");
  assert.ok(zip.file(/xl\/media\/.+\.png$/i).length >= 1);
});
