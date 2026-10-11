/**
 * scripts/testAudit.mjs
 *
 * src/lib/expenseRules.ts 의 판정 엔진 검증 스크립트.
 *
 *   npm run test:audit     (또는  node scripts/audit/testAudit.mjs)
 *
 * 한도값은 src/lib/audit/expenseRules.json 에서 그대로 읽어 넘긴다.
 * 기대값도 JSON 의 한도로부터 계산하므로, 규정이 바뀌어도 이 파일을 고칠 필요가 없다.
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// src/lib/ 은 확장자 없이 import 하므로(Next 번들러 방식) 해석 훅을 먼저 등록한다.
register('./tsHooks.mjs', import.meta.url);
const { audit } = await import('../../src/lib/audit/expenseRules.ts');

const rules = JSON.parse(readFileSync(new URL('../../src/lib/audit/expenseRules.json', import.meta.url), 'utf8'));
const MEAL_LIMIT = rules.meal.perPersonPerMeal; // 1인 1끼
const DRINK_LIMIT = rules.drink.perPersonPerDay; // 1인 1일

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

/** 을지 행 하나를 만든다. (판정에 안 쓰는 값은 기본값으로 채운다) */
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

/** EuljiFile 을 만든다. */
function file(rows, ownerName = '김서연') {
  return {
    ownerName,
    department: '공 무 부',
    cardNumber: '(기업카드) 1234-5678-9012-3456',
    usagePeriod: '2026. 04. 01 ~ 04. 30',
    personalCardTotal: 0,
    rows,
  };
}

/* ------------------------------------------------------------------ */

console.log('\n[1] 사양 예시 — 46,000원을 3명이 나눠 먹은 중식');
{
  const result = audit(file([row(10, '2026-04-15', 46000, '중식 : 김서연, 우청2')]), rules);

  // 15,334 + 15,333 + 15,333 = 46,000 (총액이 원본과 정확히 일치해야 한다)
  check(
    '인당 분배액 합계가 원본 금액과 일치',
    result.byPerson.map((p) => p.total),
    [15334, 15333, 15333],
  );
  check(
    '사람별 초과액',
    result.byPerson.map((p) => p.excess),
    [15334 - MEAL_LIMIT, 15333 - MEAL_LIMIT, 15333 - MEAL_LIMIT],
  );
  check('식대 초과 합계 = 10,000원', result.mealExcess, 10000);
  check('위반 건수', result.violations.length, 1);
  check('위반 상태', result.violations[0].status, '한도초과');
  check('참석자 3명으로 펼쳐짐', result.violations[0].participants, ['김서연', '우청#1', '우청#2']);
  check('차감 대상 총액', result.totalDeduction, 10000);
}

console.log('\n[2] 한도 이내면 위반이 아니다');
{
  // 3명이 30,000원 → 1인 10,000원 (12,000원 이내)
  const result = audit(file([row(10, '2026-04-15', 30000, '중식 : 김서연, 우청2')]), rules);
  check('위반 없음', result.violations.length, 0);
  check('초과액 0원', result.mealExcess, 0);
  check('집계는 남는다 (3명)', result.byPerson.length, 3);
}

console.log('\n[3] 음료 — 같은 날 같은 사람이 여러 행에 나뉘어 있으면 합쳐서 판정');
{
  const result = audit(
    file([
      row(10, '2026-04-15', 2000, '음료-김서연'),
      row(11, '2026-04-15', 2000, '음료-김서연'),
    ]),
    rules,
  );

  check('합산 4,000원', result.byPerson[0].total, 4000);
  check(`초과 = 4,000 - ${DRINK_LIMIT}`, result.drinkExcess, 4000 - DRINK_LIMIT);
  check('한도를 넘긴 행에 초과액이 붙는다', result.violations.map((v) => v.rowNumber), [11]);
}

console.log('\n[4] 음료 — 날짜가 다르면 합산하지 않는다');
{
  const result = audit(
    file([
      row(10, '2026-04-15', 2000, '음료-김서연'),
      row(11, '2026-04-16', 2000, '음료-김서연'),
    ]),
    rules,
  );
  check('위반 없음', result.violations.length, 0);
}

console.log('\n[5] 식대 — 끼니가 다르면 합산하지 않는다');
{
  const result = audit(
    file([
      row(10, '2026-04-15', 10000, '중식-김서연'),
      row(11, '2026-04-15', 10000, '석식-김서연'),
    ]),
    rules,
  );
  check('위반 없음 (중식·석식 각각 10,000원)', result.violations.length, 0);
  check(
    '집계에 끼니가 표시된다',
    result.byPerson.map((p) => p.category),
    ['식대(석식)', '식대(중식)'],
  );
}

console.log('\n[6] 주차 — 금지 사용처 + 금지 문구는 금액 무관 전액 위반');
{
  const result = audit(
    file([
      row(10, '2026-04-15', 30000, '주차권구매', { merchant: '누리파크' }),
      // 부분일치라 앞에 글자가 붙어도 잡혀야 한다
      row(11, '2026-04-16', 50000, '주차권구매', { merchant: '강서누리파크' }),
    ]),
    rules,
  );

  check('두 건 모두 금지항목', result.violations.map((v) => v.status), ['금지항목', '금지항목']);
  check('전액이 위반 금액', result.violations.map((v) => v.excess), [30000, 50000]);
  check('한도 개념 없음', result.violations.map((v) => v.limit), [0, 0]);
  check('주차 위반 합계', result.parkingBanned, 80000);
}

console.log('\n[7] 주차 — 그 외 주차 결제는 참고 목록으로만 분리');
{
  const result = audit(
    file([row(10, '2026-04-15', 4000, '주차비 : 정하윤(자차)', { merchant: '공영주차장' })]),
    rules,
  );

  check('위반 아님', result.violations.length, 0);
  check('참고 목록에 담김', result.parkingReference.length, 1);
  check('상태는 정상', result.parkingReference[0].status, '정상');
  check('차감액에 포함되지 않음', result.totalDeduction, 0);
}

console.log('\n[8] 계정과목 오분류가 있어도 사용내역 기준으로 판정');
{
  // 주차권구매인데 계정과목이 복리후생비로 잘못 들어간 실제 사례
  const result = audit(
    file([
      row(10, '2026-04-15', 30000, '주차권구매', {
        merchant: '누리파크',
        account: '복리후생비',
      }),
    ]),
    rules,
  );
  check('계정과목과 무관하게 금지항목', result.violations[0].status, '금지항목');
}

console.log('\n[9] 인원을 못 읽으면 확인필요로 분리 (1명으로 넘겨짚지 않는다)');
{
  const result = audit(
    file([
      row(10, '2026-04-15', 46000, '중식 4명'), // 구분자가 없어 인원 판별 불가
      row(11, '2026-04-15', 9000, '음료 3명'),
    ]),
    rules,
  );

  check('확인필요 2건', result.needsReview.length, 2);
  check('상태', result.needsReview.map((v) => v.status), ['확인필요', '확인필요']);
  check('위반으로 잡히지 않음', result.violations.length, 0);
  check('차감액에 포함되지 않음', result.totalDeduction, 0);
  check('적용 한도는 표시해 둔다', result.needsReview.map((v) => v.limit), [MEAL_LIMIT, DRINK_LIMIT]);
}

console.log('\n[10] "주유비-1742" 는 인원 파싱 자체가 돌지 않는다');
{
  const result = audit(file([row(10, '2026-04-15', 60000, '주유비-1742')]), rules);
  check('위반 없음', result.violations.length, 0);
  check('확인필요도 아님 (판정 대상 아님)', result.needsReview.length, 0);
  check('집계에도 없음', result.byPerson.length, 0);
}

console.log('\n[11] 요약 수치');
{
  const result = audit(
    file([
      row(10, '2026-04-15', 46000, '중식 : 김서연, 우청2'), // 식대 10,000 초과
      row(11, '2026-04-15', 5000, '음료-김서연'), // 음료 2,000 초과
      row(12, '2026-04-16', 30000, '주차권구매', { merchant: '누리파크' }), // 전액
      row(13, '2026-04-16', 4000, '주차비 : 정하윤(자차)'), // 참고
      row(14, '2026-04-16', 12000, '중식 4명'), // 확인필요
    ]),
    rules,
  );

  check('검사 건수', result.totalChecked, 5);
  check('식대 초과', result.mealExcess, 10000);
  check('음료 초과', result.drinkExcess, 5000 - DRINK_LIMIT);
  check('주차 금지', result.parkingBanned, 30000);
  check('차감 대상 총액', result.totalDeduction, 10000 + (5000 - DRINK_LIMIT) + 30000);
  check('참고 주차 1건', result.parkingReference.length, 1);
  check('확인필요 1건', result.needsReview.length, 1);
  check('위반은 행 번호 순', result.violations.map((v) => v.rowNumber), [10, 11, 12]);
}

console.log('\n[12] rows — 모든 행이 판정 결과에 담긴다 (정상·판정대상아님 포함)');
{
  const result = audit(
    file([
      row(10, '2026-04-15', 46000, '중식 : 김서연, 우청2'), // 한도초과
      row(11, '2026-04-17', 9000, '중식-김서연'), // 정상 (날짜가 달라 합산되지 않는다)
      row(12, '2026-04-16', 30000, '주차권구매', { merchant: '누리파크' }), // 금지항목
      row(13, '2026-04-16', 4000, '주차비 : 정하윤(자차)'), // 주차 참고
      row(14, '2026-04-16', 12000, '중식 4명'), // 확인필요
      row(15, '2026-04-16', 60000, '주유비-1742'), // 판정 대상 아님
    ]),
    rules,
  );

  check('전체 행 수', result.rows.length, 6);
  check(
    '행별 판정',
    result.rows.map((v) => `${v.rowNumber}:${v.category}/${v.status}`),
    [
      '10:식대/한도초과',
      '11:식대/정상',
      '12:주차비/금지항목',
      '13:주차비/정상',
      '14:식대/확인필요',
      '15:기타/정상',
    ],
  );
}

console.log('\n[13] 참석자를 손으로 고치면 즉시 다시 판정된다');
{
  const rows = [row(10, '2026-04-15', 46000, '중식 4명')]; // 인원을 못 읽는 표기

  const before = audit(file(rows), rules);
  check('고치기 전에는 확인필요', before.needsReview.length, 1);
  check('고치기 전 차감액 0원', before.totalDeduction, 0);

  // 화면에서 참석자 3명을 직접 입력한 상황
  const after = audit(file(rows), rules, {
    participantOverrides: { 10: ['김서연', '우청#1', '우청#2'] },
  });

  check('고친 뒤에는 확인필요 없음', after.needsReview.length, 0);
  check('고친 뒤 초과액', after.mealExcess, 10000);
  check('인당 분배액', after.rows[0].perPersonAmount, Math.floor(46000 / 3));
  check('참석자가 반영됨', after.rows[0].participants, ['김서연', '우청#1', '우청#2']);

  // 인원을 늘리면 1인당 금액이 줄어 한도 이내로 들어간다
  const four = audit(file(rows), rules, {
    participantOverrides: { 10: ['가', '나', '다', '라'] },
  });
  check('4명으로 고치면 한도 이내(11,500원)', four.totalDeduction, 0);
}

console.log('\n[14] 참석자를 다 지우면 다시 확인필요가 된다');
{
  // 원래는 정상 판정되는 행
  const rows = [row(10, '2026-04-15', 9000, '중식-김서연')];
  check('수정 전에는 정상', audit(file(rows), rules).rows[0].status, '정상');

  // 화면에서 참석자를 모두 지운 상황 → 인원을 모르므로 넘겨짚지 않는다
  const cleared = audit(file(rows), rules, { participantOverrides: { 10: [] } });
  check('지운 뒤에는 확인필요', cleared.rows[0].status, '확인필요');
  check('차감액에 포함되지 않음', cleared.totalDeduction, 0);

  // 키가 아예 없으면 "수정 없음"
  const untouched = audit(file(rows), rules, { participantOverrides: {} });
  check('키가 없으면 원본대로', untouched.rows[0].status, '정상');
}

console.log(`\n결과: ${passed}건 통과, ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
