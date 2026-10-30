/**
 * scripts/audit/makeSamples.mjs
 *
 * 규정 준수 확인 데모용 가상 경비 정산서 3종을 만든다. (화면용 1개는 public/samples, 나머지는 scripts/fixtures)
 *   node scripts/audit/makeSamples.mjs
 *
 * 회사·인물·카드번호·상호는 모두 가상이다. 양식은 정산서 자동 작성이 만드는 것과 같다
 * (src/lib/settlement/form.ts 가 하나로 정의한다).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';

register('./tsHooks.mjs', import.meta.url);
const { buildSettlementWorkbook } = await import('../../src/lib/settlement/form.ts');

// 화면에 노출하는 샘플만 public/samples, 나머지는 테스트 전용 scripts/fixtures
const PUBLIC = new URL('../../public/samples/', import.meta.url);
const FIXTURES = new URL('../fixtures/', import.meta.url);
const PUBLIC_FILES = ['경비정산서_2026년04월분_홍길동.xlsx'];
mkdirSync(PUBLIC, { recursive: true });
mkdirSync(FIXTURES, { recursive: true });

const CARD = '(기업카드) ****-****-****-3456';
const PAYMENT = { corp: '법인카드', personal: '개인카드', cash: '현금' };
const pad = (n) => String(n).padStart(2, '0');

/** 지출 한 줄. pay: 'corp' | 'personal' | 'cash' */
const r = (day, pay, amount, item, merchant, note) => ({ day, pay, amount, item, merchant, note });

async function build({ file, owner, dept, rows, topPadding }) {
  const lines = rows.map((x) => x.blank ? null : ({
    date: `2026-04-${pad(x.day)}`,
    merchant: x.merchant,
    amount: x.amount,
    payment: PAYMENT[x.pay],
    item: x.item,
    note: x.note,
  }));
  const bytes = await buildSettlementWorkbook({
    department: dept, owner, period: '2026-04-01 ~ 2026-04-30', card: CARD, lines, topPadding,
  });
  writeFileSync(new URL(file, PUBLIC_FILES.includes(file) ? PUBLIC : FIXTURES), bytes);
  console.log('wrote', file, `(${rows.filter((x) => !x.blank).length} rows)`);
}

const blank = { blank: true };

// 1) 정상에 가까운 파일
await build({
  file: '경비정산서_2026년04월분_김영호.xlsx', owner: '김영호', dept: '공무부',
  rows: [
    r(1, 'corp', 22000, '복리후생비', '한솥식당', '중식 : 김영호, 홍길동'),
    r(1, 'corp', 5000, '복리후생비', '카페온도', '음료-김영호, 홍길동'),
    r(3, 'corp', 11000, '복리후생비', '봄날식당', '석식 : 김영호'),
    blank,
    r(7, 'corp', 60000, '주유비', '한빛주유소', '주유비-1742'),
    blank,
    r(10, 'corp', 44000, '복리후생비', '대가정식', '중식 : 김영호, 정수진, 작업자2'),
    r(14, 'corp', 35000, '물품구입비', '으뜸철물', '안전용품 구입'),
    r(15, 'corp', 4000, '기타', '시청 공영주차장', '주차비'),
    blank,
    r(20, 'corp', 13000, '복리후생비', '봄날식당', '석식-김영호'), // 1인 한도 1,000원 초과
  ],
});

// 2) 화면용 샘플 — 위반 다수, 30건
//    식비·음료·주차비 15건 + 규정 비교 대상이 아닌 지출(주유비·물품·택시·택배·통행료) 15건.
//    결과 표에는 앞의 15건만 보이고, 사이사이 숨겨진 줄 때문에 표의 번호(원본 줄 번호)가 띄엄띄엄 나온다. 빈 줄 없이 꽉 찬 표다.
await build({
  file: '경비정산서_2026년04월분_홍길동.xlsx', owner: '홍길동', dept: '공무부',
  rows: [
    r(1, 'corp', 38000, '복리후생비', '푸른한식', '중식 : 홍길동, 김영호, 정수진'), // 12,667/인 → 초과
    r(1, 'corp', 62000, '주유비', '한빛주유소', '주유비-1742'), // 비교 대상 아님
    r(2, 'corp', 64000, '복리후생비', '푸른한식', '중식 : 홍길동, 김영호, 용역2'), // 16,000/인(4명)
    r(2, 'corp', 5000, '운송비', '믿음택배', '택배비'),
    r(2, 'corp', 9000, '복리후생비', '카페온도', '음료-홍길동, 김영호'), // 4,500/인
    r(2, 'corp', 2000, '복리후생비', '편의점25', '음료-홍길동'), // 같은 날 합산 6,500
    r(3, 'corp', 38000, '물품구입비', '으뜸철물', '안전용품 구입'),
    r(5, 'corp', 15000, '복리후생비', '봄날식당', '석식 : 홍길동'), // 3,000 초과
    r(5, 'corp', 11800, '여비교통비', '개인택시', '택시비'),
    r(6, 'corp', 5200, '여비교통비', '하이패스 통행료', '통행료'),
    r(6, 'corp', 8000, '복리후생비', '한솥식당', '중식-홍길동'),
    r(7, 'corp', 47000, '물품구입비', '온누리공구마트', '공구 구입'),
    r(8, 'corp', 30000, '복리후생비', '누리파크', '주차권구매'), // 주차 금지 사용처+문구
    r(9, 'corp', 50000, '복리후생비', '강서 누리파크', '주차권구매'), // 표기 흔들림도 적발
    r(9, 'corp', 58000, '주유비', '한빛주유소', '주유비-1742'),
    r(10, 'corp', 14300, '여비교통비', '개인택시', '택시비'),
    r(10, 'corp', 24000, '복리후생비', '대가정식', '중식 : 홍길동, 작업자2'), // 3명 → 8,000/인
    r(12, 'corp', 48000, '복리후생비', '대가정식', '중식 4명'), // 인원 표기 없음
    r(12, 'corp', 30000, '복리후생비', '봄날식당', '석식'), // 구분자 없음
    r(13, 'corp', 6000, '운송비', '믿음택배', '택배비'),
    r(14, 'corp', 5500, '복리후생비', '카페온도', '음료 : 홍길동, 김영호'), // 2,750/인
    r(14, 'corp', 11000, '물품구입비', '다이소', '사무용품 구입'),
    r(16, 'corp', 26000, '복리후생비', '푸른한식', '중식 : 홍길동, 김영호'), // 13,000/인 → 초과
    r(16, 'corp', 66000, '주유비', '한빛주유소', '주유비-1742'),
    r(19, 'corp', 4000, '기타', '시청 공영주차장', '주차비'), // 금지 문구 없음 → 참고
    r(20, 'corp', 12800, '여비교통비', '개인택시', '택시비'),
    r(20, 'corp', 34000, '물품구입비', '으뜸철물', '장비 수리'),
    r(22, 'corp', 55000, '주유비', '한빛주유소', '주유비-1742'),
    r(27, 'corp', 7000, '복리후생비', '카페온도', '음료-홍길동'), // 4,000 초과
    r(29, 'corp', 62000, '주유비', '한빛주유소', '주유비-1742'),
  ],
});

// 3) 제목 위에 빈 줄이 하나 더 있는 파일 — 표기 변형·개인카드·현금 혼합
await build({
  file: '경비정산서_2026년04월분_정수진.xlsx', owner: '정수진', dept: '현장팀', topPadding: 1,
  rows: [
    r(3, 'corp', 20000, '복리후생비', '한솥식당', '조식 : 정수진, 홍길동'),
    r(3, 'corp', 40000, '복리후생비', '푸른한식', '중 식 : 정수진 , 홍길동, 김영호'), // 13,334/13,333/13,333
    r(4, 'corp', 3500, '복리후생비', '카페온도', '음료구매-정수진'),
    blank,
    r(10, 'corp', 12000, '복리후생비', '봄날식당', '석식-'), // 구분자 뒤가 비면 담당자 1명
    r(11, 'corp', 25000, '복리후생비', '누리파크', '주차권구매'),
    blank,
    r(17, 'corp', 60000, '복리후생비', '대가정식', '석식'), // 인원 없음
    r(18, 'personal', 9500, '복리후생비', '분식나라', '중식 : 정수진'),
    r(25, 'cash', 8000, '여비교통비', '개인택시', '택시비'),
  ],
});
