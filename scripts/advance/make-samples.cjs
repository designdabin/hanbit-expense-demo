// 전도금 데모용 가상 카드 승인내역서를 만든다. 실제 파일을 복사하지 않고 전부 새로 생성한다.
// 사용법: node scripts/advance/make-samples.cjs   ->  화면용 1개는 public/samples, 나머지는 scripts/fixtures
// 카드 끝 4자리는 src/lib/advance/cards.ts 의 시드 카드와 맞춰져 있다.
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

// 화면에 노출하는 샘플만 public/samples, 나머지는 테스트 전용 scripts/fixtures
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public", "samples");
const FIXTURE_DIR = path.join(__dirname, "..", "fixtures");
const PUBLIC_FILES = ["법인카드_승인내역_국민카드_2026년03월_오민재.xlsx"];
const HEADERS = ["승인일", "가맹점명", "승인금액", "카드번호", "승인번호", "사업자등록번호", "업종명", "상태", "취소금액", "취소일자"];

const card = (last4) => "9411-****-****-" + last4;
let approvalSeq = 100;
const nextApproval = (prefix) => prefix + String(++approvalSeq);

// [일, 가맹점, 금액, 업종, (선택) 승인번호]
function toRows(last4, ym, items, prefix) {
  return items.map(([day, merchant, amount, industry, approval]) => [
    ym + "-" + String(day).padStart(2, "0"), merchant, amount, card(last4), approval ?? nextApproval(prefix),
    "123-45-" + String(60000 + (merchant.length * 137 + amount) % 39999), industry, "정상", "", "",
  ]);
}

function write(file, aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "승인내역");
  const dir = PUBLIC_FILES.includes(file) ? PUBLIC_DIR : FIXTURE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  XLSX.writeFile(wb, path.join(dir, file));
  console.log("wrote", file, aoa.length, "rows");
}

// 1) 정상: 국민카드 이서준 (4471), 2026-03
write("법인카드_승인내역_국민카드_2026년03월_이서준.xlsx", [HEADERS, ...toRows("4471", "2026-03", [
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

// 2) 헤더 없는 기업카드 7열: 승인일, 카드번호, 가맹점, 금액, 승인번호, (공란), 사업자번호 (정하윤, 8206)
const headerless = [
  [2, "새싹 식당", 11000, "P41"], [2, "온누리 문구", 7300, "P42"], [5, "가람 주유소", 55000, "P43"],
  [6, "행복 커피", 4800, "P44"], [6, "한빛 건재", 63000, "P45"], [9, "모범 택시", 9700, "P46"],
  [10, "청솔 한식당", 19000, "P47"], [12, "믿음 택배", 4500, "P48"], [16, "GS25 온누리점", 6200, "P49"],
  [19, "하이패스 통행료", 3100, "P50"],
];
write("법인카드_승인내역_기업카드_2026년03월_정하윤.xlsx", headerless.map(([day, merchant, amount, approval]) => [
  "2026-03-" + String(day).padStart(2, "0"), card("8206"), merchant, amount, approval, "", "987-65-" + String(10000 + amount % 8999),
]));

// 3) 취소건 포함: 국민카드 오민재 (3159)
//    - 승인번호로 매칭되는 취소(A), 카드+가맹점+금액+원거래일로 매칭되는 취소(B), 정상 건들
const cancelBase = toRows("3159", "2026-03", [
  [3, "온누리 김밥천국", 9500, "한식", "C7001"],
  [4, "청솔 한식당", 30000, "한식", "C7002"], // 아래에서 승인번호로 취소
  [5, "온누리 문구", 12000, "문구", "C7003"], // 아래에서 상세 조건으로 취소
  [9, "가람 주유소", 60000, "주유소", "C7004"],
  [10, "한빛 철물자재", 34000, "철물점", "C7005"],
  [11, "행복 커피", 5200, "커피전문점", "C7006"],
  [13, "믿음 택배", 6000, "택배", "C7007"],
  [17, "모범 택시", 14300, "택시", "C7008"],
]);
const cancelByApproval = ["2026-03-06", "청솔 한식당", -30000, card("3159"), "C7002", "123-45-70001", "한식", "승인취소", "", ""];
const cancelByDetail = ["2026-03-07", "온누리 문구", -12000, card("3159"), "", "123-45-70002", "문구", "취소", 12000, "2026-03-05"];
write("법인카드_승인내역_국민카드_2026년03월_오민재.xlsx", [HEADERS, ...cancelBase, cancelByApproval, cancelByDetail]);

// 4) 행이 많은 신청서: 기업카드 한지우 (6023), 2026-04, 36건 -> 양식 기본 31행을 넘겨 행 추가 동작 확인
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
write("법인카드_승인내역_기업카드_2026년04월_한지우.xlsx", [HEADERS, ...toRows("6023", "2026-04", longItems, "L")]);
