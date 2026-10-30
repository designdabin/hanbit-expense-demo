// 정산서 자동 작성 데모용 가상 카드 승인내역서를 만든다. 실제 파일을 복사하지 않고 전부 새로 생성한다.
// 사용법: node scripts/advance/make-samples.cjs   ->  화면용 1개는 public/samples, 나머지는 scripts/fixtures
// 카드 끝 4자리는 src/lib/advance/cards.ts 의 시드 카드와 맞춰져 있다.
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

// 화면에 노출하는 샘플만 public/samples, 나머지는 테스트 전용 scripts/fixtures
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public", "samples");
const FIXTURE_DIR = path.join(__dirname, "..", "fixtures");
const PUBLIC_FILES = ["법인카드_승인내역_국민카드_2026년03월_홍길동.xlsx"];
// 취소 건은 상태("승인취소")와 음수 금액으로 나타낸다. 취소금액·취소일자 열을 쓰는 카드사 파일은 파서가 따로 읽고, advance.test.mts 가 검증한다.
const HEADERS = ["승인일", "가맹점명", "승인금액", "카드번호", "승인번호", "사업자등록번호", "업종명", "상태"];

const card = (last4) => "9411-****-****-" + last4;
let approvalSeq = 100;
const nextApproval = (prefix) => prefix + String(++approvalSeq);

// [일, 가맹점, 금액, 업종, (선택) 승인번호]
function toRows(last4, ym, items, prefix) {
  return items.map(([day, merchant, amount, industry, approval]) => [
    ym + "-" + String(day).padStart(2, "0"), merchant, amount, card(last4), approval ?? nextApproval(prefix),
    "123-45-" + String(60000 + (merchant.length * 137 + amount) % 39999), industry, "정상",
  ]);
}

// 모든 칸에 테두리, 제목 줄(있으면)은 굵은 글씨에 회색 배경. amountColumn 은 1부터 센 금액 열.
async function write(file, aoa, { header = true, amountColumn = 3 } = {}) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("승인내역");
  const line = { style: "thin", color: { argb: "FF6B7280" } };
  const box = { top: line, bottom: line, left: line, right: line };
  aoa.forEach((values, index) => {
    const row = sheet.addRow(values);
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.border = box;
      cell.alignment = { vertical: "middle", horizontal: column === amountColumn ? "right" : "left" };
      if (column === amountColumn) cell.numFmt = "#,##0";
    });
    if (header && index === 0) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1D5DB" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
    }
  });
  sheet.columns.forEach((column) => {
    let width = 8;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const length = String(cell.value ?? "").length;
      width = Math.max(width, length + 4);
    });
    column.width = Math.min(width, 26);
  });
  const dir = PUBLIC_FILES.includes(file) ? PUBLIC_DIR : FIXTURE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  await wb.xlsx.writeFile(path.join(dir, file));
  console.log("wrote", file, aoa.length, "rows");
}

(async () => {

// 1) 정상: 국민카드 김철수 (4471), 2026-03
await write("법인카드_승인내역_국민카드_2026년03월_김철수.xlsx", [HEADERS, ...toRows("4471", "2026-03", [
  [3, "온누리 김밥천국", 9000, "한식", "A0301"],
  [3, "가람 주유소", 68000, "주유소"],
  [4, "한빛 철물자재", 42500, "철물점"],
  [4, "행복 커피", 4500, "커피전문점"],
  [5, "모범 택시", 12800, "택시"],
  [6, "청솔 한식당", 24000, "한식"],
  [9, "GS25 가람점", 3900, "편의점"],
  [9, "다이소 온누리점", 11000, "다이소"],
  [10, "가람 주유소", 72000, "주유소"],
  [11, "하이패스 통행료", 6400, "통행료"],
  [12, "믿음 택배", 5500, "택배"],
  [13, "새벽 중식당", 26000, "중식"],
  [16, "온누리 공구마트", 89000, "공구"],
  [17, "한빛빌딩 주차장", 8000, "주차장"],
  [18, "행복 커피", 5000, "커피전문점"],
  [20, "청솔 한식당", 22000, "한식"],
  [24, "빠른 퀵서비스", 15000, "퀵"],
  [26, "온누리 김밥천국", 8500, "한식"],
], "N")]);

// 2) 헤더 없는 기업카드 7열: 승인일, 카드번호, 가맹점, 금액, 승인번호, (공란), 사업자번호 (이영희, 8206)
const headerless = [
  [2, "새싹 식당", 11000, "P41"], [2, "온누리 문구", 7300, "P42"], [5, "가람 주유소", 55000, "P43"],
  [6, "행복 커피", 4800, "P44"], [6, "한빛 건재", 63000, "P45"], [9, "모범 택시", 9700, "P46"],
  [10, "청솔 한식당", 19000, "P47"], [12, "믿음 택배", 4500, "P48"], [16, "GS25 온누리점", 6200, "P49"],
  [19, "하이패스 통행료", 3100, "P50"],
];
await write("법인카드_승인내역_기업카드_2026년03월_이영희.xlsx", headerless.map(([day, merchant, amount, approval]) => [
  "2026-03-" + String(day).padStart(2, "0"), card("8206"), merchant, amount, approval, "", "987-65-" + String(10000 + amount % 8999),
]), { header: false, amountColumn: 4 });

// 3) 화면용 샘플: 국민카드 홍길동 (3159), 2026-03
//    승인 33건 중 3건(C7003·C7005·C7023)은 '승인취소' 행이 승인번호로 짝을 이뤄 빠져서, 정산 건수는 30건(양식 기본 31행 안).
//    카드+가맹점+금액+원거래일로 짝을 찾는 취소는 advance.test.mts 가 자체 데이터로 검증한다.
const hongBase = toRows("3159", "2026-03", [
  [3, "온누리 김밥천국", 9500, "한식", "C7001"],
  [3, "가람 주유소", 62000, "주유소", "C7002"],
  [4, "청솔 한식당", 30000, "한식", "C7003"], // 취소됨
  [4, "행복 커피", 4800, "커피전문점", "C7004"],
  [5, "온누리 문구", 12000, "문구", "C7005"], // 취소됨
  [5, "모범 택시", 11800, "택시", "C7006"],
  [6, "한빛 철물자재", 34000, "철물점", "C7007"],
  [9, "온누리 김밥천국", 8500, "한식", "C7008"],
  [9, "믿음 택배", 6000, "택배", "C7009"],
  [10, "청솔 한식당", 24000, "한식", "C7010"],
  [10, "하이패스 통행료", 5200, "통행료", "C7011"],
  [11, "행복 커피", 5200, "커피전문점", "C7012"],
  [11, "온누리 공구마트", 47000, "공구", "C7013"],
  [12, "가람 주유소", 58000, "주유소", "C7014"],
  [13, "새벽 중식당", 26000, "중식", "C7015"],
  [13, "GS25 가람점", 3900, "편의점", "C7016"],
  [16, "한빛빌딩 주차장", 8000, "주차장", "C7017"],
  [16, "모범 택시", 14300, "택시", "C7018"],
  [17, "온누리 문구", 7300, "문구", "C7019"],
  [17, "청솔 한식당", 22000, "한식", "C7020"],
  [18, "다이소 온누리점", 11000, "다이소", "C7021"],
  [18, "행복 커피", 4500, "커피전문점", "C7022"],
  [19, "빠른 퀵서비스", 15000, "퀵", "C7023"], // 취소됨
  [20, "한빛 철물자재", 42500, "철물점", "C7024"],
  [23, "가람 주유소", 66000, "주유소", "C7025"],
  [23, "믿음 택배", 5500, "택배", "C7026"],
  [24, "온누리 김밥천국", 9000, "한식", "C7027"],
  [25, "하이패스 통행료", 6400, "통행료", "C7028"],
  [26, "새벽 중식당", 28000, "중식", "C7029"],
  [27, "모범 택시", 12800, "택시", "C7030"],
  [30, "행복 커피", 5000, "커피전문점", "C7031"],
  [30, "온누리 공구마트", 39000, "공구", "C7032"],
  [31, "청솔 한식당", 23000, "한식", "C7033"],
]);
const cancelRow = (date, merchant, amount, approval, industry, bizNo) =>
  [date, merchant, -amount, card("3159"), approval, bizNo, industry, "승인취소"];
await write("법인카드_승인내역_국민카드_2026년03월_홍길동.xlsx", [HEADERS, ...hongBase,
  cancelRow("2026-03-06", "청솔 한식당", 30000, "C7003", "한식", "123-45-70001"),
  cancelRow("2026-03-07", "온누리 문구", 12000, "C7005", "문구", "123-45-70002"),
  cancelRow("2026-03-20", "빠른 퀵서비스", 15000, "C7023", "퀵", "123-45-70003"),
]);

// 4) 행이 많은 신청서: 기업카드 박민수 (6023), 2026-04, 36건 -> 양식 기본 31행을 넘겨 행 추가 동작 확인
const merchants = [
  ["온누리 김밥천국", 9000, "한식"], ["청솔 한식당", 23000, "한식"], ["가람 주유소", 65000, "주유소"],
  ["한빛 철물자재", 38000, "철물점"], ["행복 커피", 4700, "커피전문점"], ["모범 택시", 11400, "택시"],
  ["믿음 택배", 5000, "택배"], ["하이패스 통행료", 5200, "통행료"], ["온누리 공구마트", 47000, "공구"],
];
const longItems = [];
for (let i = 0; i < 36; i += 1) {
  const [name, amount, industry] = merchants[i % merchants.length];
  longItems.push([Math.min(30, 1 + Math.floor(i * 0.8) + (i % 3)), name, amount + (i % 4) * 500, industry]);
}
await write("법인카드_승인내역_기업카드_2026년04월_박민수.xlsx", [HEADERS, ...toRows("6023", "2026-04", longItems, "L")]);

})();
