/**
 * scripts/testAuditReport.mjs
 *
 * src/lib/auditReport.ts 검증 스크립트.
 *
 *   npm run test:report     (또는  node scripts/audit/testAuditReport.mjs)
 *
 * 확인하는 것
 *   1) 시트 3개와 각 시트의 열 이름이 사양대로인지
 *   2) 담당자 한 명 / 여러 명일 때 파일명 규칙
 *   3) 만들어진 엑셀이 실제로 다시 열리는지 (새 워크북이 정상인지)
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// src/lib/ 은 확장자 없이 import 하므로(Next 번들러 방식) 해석 훅을 먼저 등록한다.
register('./tsHooks.mjs', import.meta.url);
const { audit } = await import('../../src/lib/audit/expenseRules.ts');
const { buildAuditReportBytes, buildAuditReportFileName, buildAuditReportWorkbook } = await import(
  '../../src/lib/audit/auditReport.ts'
);
const XLSX = await import('../../node_modules/xlsx/xlsx.mjs');

const rules = JSON.parse(
  readFileSync(new URL('../../src/lib/audit/expenseRules.json', import.meta.url), 'utf8'),
);

let passed = 0;
let failed = 0;

/** 검사 하나를 실행하고 결과를 출력한다. */
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${label}`);
    console.log(`       기대: ${e}`);
    console.log(`       실제: ${a}`);
  }
}

/** 을지 행 하나 */
function row(rowNumber, date, amount, note, extra = {}) {
  return {
    rowNumber,
    date,
    siteName: '판교 A현장',
    amount,
    paymentMethod: '법인카드',
    account: '복리후생비',
    merchant: '식당',
    note,
    remark: '',
    ...extra,
  };
}

/** EuljiFile 하나 */
function file(ownerName, rows) {
  return {
    ownerName,
    department: '공 무 부',
    cardNumber: '(기업카드) 1234-5678-9012-3456',
    usagePeriod: '2026. 04. 01 ~ 04. 30',
    personalCardTotal: 100000,
    rows,
  };
}

// 담당자 두 명분 판정 결과를 만든다.
const 홍길동 = audit(
  file('홍길동', [
    row(10, '2026-04-15', 46000, '중식 : 홍길동, 우청2'), // 한도초과
    row(11, '2026-04-16', 9000, '중식-홍길동'), // 정상
    row(12, '2026-04-16', 30000, '주차권구매', { merchant: '누리파크' }), // 금지항목
    row(13, '2026-04-16', 4000, '주차비 : 이영희(자차)', { merchant: '공영주차장' }), // 주차 참고
    row(14, '2026-04-17', 12000, '중식 4명'), // 확인필요
    row(15, '2026-04-17', 60000, '주유비-1742'), // 판정 대상 아님
  ]),
  rules,
);
const 김영호 = audit(
  file('김영호', [row(7, '2026-04-15', 20000, '음료-김영호')]),
  rules,
);

/* ------------------------------------------------------------------ */

console.log('\n[1] 시트 구성');
{
  const wb = buildAuditReportWorkbook([홍길동, 김영호]);
  check('시트 3개', wb.SheetNames, ['위반내역', '인별집계', '정산요약']);

  const columns = (name) => Object.keys(XLSX.utils.sheet_to_json(wb.Sheets[name])[0] ?? {});

  check('위반내역 열', columns('위반내역'), [
    '담당자', '행번호', '일자', '구분', '결제수단', '사용처', '사용내역',
    '인원(명)', '사용금액(원)', '인당 분배액(원)', '한도(원)', '초과금액(원)', '판정',
  ]);
  check('인별집계 열', columns('인별집계'), [
    '담당자', '참석자', '일자', '구분', '합산금액(원)', '한도(원)', '초과금액(원)',
  ]);
  check('정산요약 열', columns('정산요약'), [
    '담당자', '사용기간', '식대 초과분(원)', '음료 초과분(원)', '전액 차감 주차비(원)',
    '차감 대상 총액(원)', '개인카드 신청액(원)', '상계 후 정산액(원)',
  ]);
}

console.log('\n[2] 위반내역 — 조치가 필요한 행만 담는다');
{
  const wb = buildAuditReportWorkbook([홍길동]);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['위반내역']);

  // 판정 열에는 내부 판정값이 아니라 화면과 같은 말(src/lib/statusLabels.ts)이 들어간다.
  // 13행은 판정값이 '정상'인 주차 참고내역이라 화면과 같이 "주차 (문제 없음)"으로 적힌다.
  check(
    '담긴 행과 판정',
    rows.map((r) => `${r.행번호}:${r.판정}`),
    ['10:초과분 본인 부담', '12:전액 본인 부담', '13:주차 (문제 없음)', '14:인원 확인 필요'],
  );
  check('정상 식대(11행)와 판정대상아님(15행)은 빠진다', rows.some((r) => r.행번호 === 11 || r.행번호 === 15), false);
  check('담당자 열이 채워진다', rows[0].담당자, '홍길동');
  check('식대는 끼니까지 표시', rows[0].구분, '식대(중식)');
  // 참석자 이름이 아니라 인원 수가 들어간다 ("중식 : 홍길동, 우청2" → 3명)
  check('인원(명)', rows[0]['인원(명)'], 3);
  check('판정 대상이 아닌 행은 인원이 비어 있다', rows.find((r) => r.행번호 === 12)['인원(명)'], '');
}

console.log('\n[3] 정산요약 — 담당자별 1행');
{
  const wb = buildAuditReportWorkbook([홍길동, 김영호]);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['정산요약']);

  check('담당자 수만큼 1행씩', rows.length, 2);
  check('담당자', rows.map((r) => r.담당자), ['홍길동', '김영호']);
  check(
    '상계 후 정산액 = 개인카드 신청액 - 차감 대상 총액',
    rows.map((r) => r['상계 후 정산액(원)']),
    rows.map((r) => r['개인카드 신청액(원)'] - r['차감 대상 총액(원)']),
  );
  check('홍길동 차감 대상 총액', rows[0]['차감 대상 총액(원)'], 홍길동.totalDeduction);
}

console.log('\n[4] 인별집계 — 담당자 열이 붙는다');
{
  const wb = buildAuditReportWorkbook([홍길동, 김영호]);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['인별집계']);
  check('두 담당자의 집계가 모두 담긴다', [...new Set(rows.map((r) => r.담당자))], ['홍길동', '김영호']);
}

console.log('\n[5] 파일명 규칙');
{
  check('담당자 한 명', buildAuditReportFileName([홍길동]), '경비규정검증_04월분_홍길동.xlsx');
  check('여러 담당자', buildAuditReportFileName([홍길동, 김영호]), '경비규정검증_04월분_전체.xlsx');

  // 사용기간이 비어 있으면 행의 일자에서 월을 집는다.
  const noPeriod = audit(
    { ...file('정수진', [row(7, '2026-07-03', 5000, '음료-정수진')]), usagePeriod: '' },
    rules,
  );
  check('사용기간이 없으면 일자에서', buildAuditReportFileName([noPeriod]), '경비규정검증_07월분_정수진.xlsx');

  // 월도 담당자도 못 읽는 경우
  const unknown = audit({ ...file('', []), usagePeriod: '' }, rules);
  check('둘 다 못 읽으면', buildAuditReportFileName([unknown]), '경비규정검증_담당자미상.xlsx');

  // 같은 사람의 여러 달을 묶는 경우 — 첫 달만 쓰면 나머지 달이 숨는다
  const 삼월 = audit(
    { ...file('김영호', [row(8, '2026-03-09', 14260, '석식-김영호')]), usagePeriod: '2026. 03. 01 ~ 31' },
    rules,
  );
  const 사월 = audit(
    { ...file('김영호', [row(8, '2026-04-01', 15000, '중식-김영호')]), usagePeriod: '2026. 04. 01 ~ 30' },
    rules,
  );
  check('여러 달을 묶으면 모두 적는다', buildAuditReportFileName([삼월, 사월]), '경비규정검증_03-04월분_김영호.xlsx');
}

console.log('\n[6] 만들어진 엑셀이 실제로 다시 열린다');
{
  const bytes = buildAuditReportBytes([홍길동, 김영호]);
  check('바이트 길이를 잴 수 있다', bytes.length > 0, true);

  const reopened = XLSX.read(bytes, { type: 'array' });
  check('다시 읽은 시트', reopened.SheetNames, ['위반내역', '인별집계', '정산요약']);
}

console.log('\n[7] 판정할 건이 없어도 시트는 만들어진다');
{
  const empty = audit(file('홍길동', []), rules);
  const wb = buildAuditReportWorkbook([empty]);
  check('시트 3개 유지', wb.SheetNames, ['위반내역', '인별집계', '정산요약']);
  check('빈 안내 문구', XLSX.utils.sheet_to_json(wb.Sheets['위반내역'], { header: 1 })[0], [
    '조치가 필요한 건이 없습니다.',
  ]);
}

console.log(`\n결과: ${passed}건 통과, ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
