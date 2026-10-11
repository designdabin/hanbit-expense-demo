/**
 * scripts/audit/makeSamples.mjs
 *
 * 데모용 가상 전도금 신청서 3종을 public/samples/ 에 생성한다.
 *   node scripts/audit/makeSamples.mjs
 *
 * 회사·인물·카드번호·현장·상호는 모두 가상이다. 시트 구성(표지/갑지/을지)과 셀 위치만
 * 파서(src/lib/audit/euljiParser.ts)가 읽는 양식에 맞춘다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as XLSX from '../../node_modules/xlsx/xlsx.mjs';

// 화면에 노출하는 샘플만 public/samples, 나머지는 테스트 전용 scripts/fixtures
const PUBLIC = new URL('../../public/samples/', import.meta.url);
const FIXTURES = new URL('../fixtures/', import.meta.url);
const PUBLIC_FILES = ['전도금신청서_2026년04월분_홍길동.xlsx'];
mkdirSync(PUBLIC, { recursive: true });
mkdirSync(FIXTURES, { recursive: true });

const CARD = '(기업카드) 1234-5678-9012-3456';
const ACCOUNTS = ['복리후생비', '주유비', '여비교통비', '물품구입비', '운송비', '기타'];
/** 2026-04-01 = 엑셀 시리얼 46113 */
const serial = (day) => 46113 + day - 1;

/**
 * 지출 한 줄. pay: 'corp' | 'personal' | 'cash'
 * day 를 넘기면 그 날의 첫 행(일자 표시), 생략하면 일자 칸을 비운다(직전 날짜 상속).
 */
const r = (day, site, pay, amount, account, merchant, note, remark = '') => ({ day, site, pay, amount, account, merchant, note, remark });

function build({ file, owner, dept, headerRow, rows }) {
  const wb = XLSX.utils.book_new();

  // 표지
  const cover = XLSX.utils.aoa_to_sheet([[], [], ['한빛건설 주식회사'], [], ['전 도 금 신 청 서'], [], ['2026년 04월분']]);
  XLSX.utils.book_append_sheet(wb, cover, '표지');

  // 갑지: 소속 G5, 성명 O5, 사용기간 G8, 카드번호 G9, 개인카드 합계 V25
  const personalTotal = rows.filter((x) => x.pay === 'personal').reduce((s, x) => s + x.amount, 0);
  const gapji = XLSX.utils.aoa_to_sheet([[], [], [], [], []]);
  const put = (a, cell) => { gapji[a] = cell; };
  put('G5', { t: 's', v: dept });
  put('O5', { t: 's', v: owner });
  put('G8', { t: 's', v: '2026. 04. 01 ~ 04. 30' });
  put('G9', { t: 's', v: CARD });
  put('V25', { t: 'n', v: personalTotal, f: 'SUM(V10:V24)' });
  gapji['!ref'] = 'A1:Z30';
  XLSX.utils.book_append_sheet(wb, gapji, '갑지');

  // 을지: 헤더 행(headerRow, 1-based) 아래 한 줄은 소제목, 데이터는 그 다음 줄부터
  const grid = Array.from({ length: headerRow - 1 }, () => []);
  const head = [];
  head[0] = '일 자'; head[1] = '현장명'; head[4] = '법인카드'; head[5] = '개인카드'; head[6] = '현금';
  ACCOUNTS.forEach((a, i) => { head[7 + i] = a; });
  head[13] = '사용처'; head[15] = '사용내역'; head[19] = '비고';
  grid.push(head, []);

  const sum = { corp: 0, personal: 0, cash: 0 };
  let prevDay = null;
  for (const x of rows) {
    if (x.blank) { grid.push([]); continue; }
    const line = [];
    if (x.day !== prevDay) { line[0] = serial(x.day); prevDay = x.day; }
    line[1] = x.site;
    line[{ corp: 4, personal: 5, cash: 6 }[x.pay]] = x.amount;
    line[7 + ACCOUNTS.indexOf(x.account)] = x.amount;
    line[13] = x.merchant; line[15] = x.note;
    if (x.remark) line[19] = x.remark;
    sum[x.pay] += x.amount;
    grid.push(line);
  }
  grid.push([]);
  grid.push(['합 계', , , , sum.corp, sum.personal, sum.cash]);

  // 아래쪽 규정 안내 블록에도 "합 계"가 한 번 더 있다. 파서는 첫 번째 합계에서 멈춰야 하며
  // 여기의 999999999 는 읽히면 안 되는 함정 값이다.
  grid.push([], ['경비 규정 안내'], ['식대: 1인 1식 12,000원 이내'], ['음료: 1인 1일 3,000원 이내'], ['주차비: 주차권 구매 사용 불가']);
  grid.push(['합 계', , , , 999999999, , 999999999]);

  const eulji = XLSX.utils.aoa_to_sheet(grid);
  eulji['!merges'] = grid.flatMap((line, i) => (line[1] ? [{ s: { r: i, c: 1 }, e: { r: i, c: 3 } }, { s: { r: i, c: 13 }, e: { r: i, c: 14 } }, { s: { r: i, c: 15 }, e: { r: i, c: 18 } }] : []));
  XLSX.utils.book_append_sheet(wb, eulji, '을지');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['차량운행 일지']]), '차량운행 일지');

  writeFileSync(new URL(file, PUBLIC_FILES.includes(file) ? PUBLIC : FIXTURES), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log('wrote', file, `(header row ${headerRow}, ${rows.filter((x) => !x.blank).length} rows)`);
}

const A = '판교 하늘빌딩 현장', B = '수원 새솔단지 현장';
const blank = { blank: true };

// 1) 정상에 가까운 파일 — 구 양식(헤더 6행)
build({
  file: '전도금신청서_2026년04월분_김서연.xlsx', owner: '김 서 연', dept: '공 무 부', headerRow: 6,
  rows: [
    r(1, A, 'corp', 22000, '복리후생비', '한솥식당', '중식 : 김서연, 홍길동'),
    r(1, A, 'corp', 5000, '복리후생비', '카페온도', '음료-김서연, 홍길동'),
    r(3, A, 'corp', 11000, '복리후생비', '봄날식당', '석식 : 김서연'),
    blank,
    r(7, B, 'corp', 60000, '주유비', '한빛주유소', '주유비-1742'),
    blank,
    r(10, B, 'corp', 44000, '복리후생비', '대가정식', '중식 : 김서연, 이도윤, 작업자2'),
    r(14, B, 'corp', 35000, '물품구입비', '으뜸철물', '안전용품 구입'),
    r(15, B, 'corp', 4000, '기타', '시청 공영주차장', '주차비'),
    blank,
    r(20, A, 'corp', 13000, '복리후생비', '봄날식당', '석식-김서연'), // 1인 한도 1,000원 초과
  ],
});

// 2) 위반 다수 — 구 양식(헤더 6행)
build({
  file: '전도금신청서_2026년04월분_홍길동.xlsx', owner: '홍 길 동', dept: '공 무 부', headerRow: 6,
  rows: [
    r(2, A, 'corp', 64000, '복리후생비', '푸른한식', '중식 : 홍길동, 김서연, 용역2'), // 16,000/인
    r(2, A, 'corp', 9000, '복리후생비', '카페온도', '음료-홍길동, 김서연'), // 4,500/인
    r(2, A, 'corp', 2000, '복리후생비', '편의점25', '음료-홍길동'), // 같은 날 합산 6,500
    blank,
    r(5, B, 'corp', 15000, '복리후생비', '봄날식당', '석식 : 홍길동'),
    r(6, B, 'corp', 8000, '복리후생비', '한솥식당', '중식-홍길동'),
    r(8, B, 'corp', 30000, '복리후생비', '누리파크', '주차권구매'), // 주차 금지 사용처+문구
    r(9, B, 'corp', 50000, '복리후생비', '강서 누리파크', '주차권구매'), // 표기 흔들림도 적발
    blank,
    r(12, A, 'corp', 48000, '복리후생비', '대가정식', '중식 4명'), // 인원 표기 없음
    r(12, A, 'corp', 30000, '복리후생비', '봄날식당', '석식'), // 구분자 없음
    r(15, A, 'corp', 6000, '복리후생비', '카페온도', '음료 : 김서연, 용역1인'),
    r(20, A, 'corp', 20000, '여비교통비', '누리파크', '주차 정기권'), // 금지 문구 없음 → 참고
    r(22, B, 'corp', 55000, '주유비', '한빛주유소', '주유비-1742'),
  ],
});

// 3) 개정 양식(헤더 5행) — 표기 변형·개인카드·현금 혼합
build({
  file: '전도금신청서_2026년04월분_이도윤.xlsx', owner: '이 도 윤', dept: '현 장 팀', headerRow: 5,
  rows: [
    r(3, A, 'corp', 20000, '복리후생비', '한솥식당', '조식 : 이도윤, 홍길동'),
    r(3, A, 'corp', 40000, '복리후생비', '푸른한식', '중 식 : 이도윤 , 홍길동, 김서연'), // 13,334/13,333/13,333
    r(4, A, 'corp', 3500, '복리후생비', '카페온도', '음료구매-이도윤'),
    blank,
    r(10, B, 'corp', 12000, '복리후생비', '봄날식당', '석식-'), // 구분자 뒤가 비면 담당자 1명
    r(11, B, 'corp', 25000, '복리후생비', '누리파크', '주차권구매'),
    blank,
    r(17, B, 'corp', 60000, '복리후생비', '대가정식', '석식', '야근'), // 인원 없음
    r(18, A, 'personal', 9500, '복리후생비', '분식나라', '중식 : 이도윤'),
    r(25, A, 'cash', 8000, '여비교통비', '개인택시', '택시비'),
  ],
});
