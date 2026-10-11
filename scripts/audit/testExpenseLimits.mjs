/**
 * scripts/testExpenseLimits.mjs
 *
 * src/lib/expenseLimits.ts — 화면에서 고친 한도를 다루는 모듈의 검증 스크립트.
 *
 *   npm run test:limits    (또는  node scripts/audit/testExpenseLimits.mjs)
 *
 * 확인하는 것은 두 가지다.
 *   1) 고친 한도가 규정 객체에 제대로 덮어써지는가 (원본을 건드리지 않는가)
 *   2) 그 한도로 판정했을 때 결과가 실제로 달라지는가
 *
 * 2번이 핵심이다. 한도만 바뀌고 판정이 그대로면 모달은 아무 일도 하지 않은 셈이다.
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./tsHooks.mjs', import.meta.url);
const { audit } = await import('../../src/lib/audit/expenseRules.ts');
const { withLimits, limitsOf, limitError, limitsError, parseLimits, sameLimits, LIMIT_MAX } =
  await import('../../src/lib/audit/expenseLimits.ts');

const rules = JSON.parse(readFileSync(new URL('../../src/lib/audit/expenseRules.json', import.meta.url), 'utf8'));

let passed = 0;
let failed = 0;

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

function file(rows, ownerName = '홍길동') {
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

console.log('\n[1] limitsOf — 규정에서 지금 한도를 꺼낸다');
{
  check('규정 JSON 의 한도와 같다', limitsOf(rules), {
    mealPerPersonPerMeal: rules.meal.perPersonPerMeal,
    drinkPerPersonPerDay: rules.drink.perPersonPerDay,
  });
}

console.log('\n[2] withLimits — 한도만 덮어쓴다');
{
  const next = withLimits(rules, { mealPerPersonPerMeal: 20000, drinkPerPersonPerDay: 5000 });

  check('식대 한도가 바뀐다', next.meal.perPersonPerMeal, 20000);
  check('음료 한도가 바뀐다', next.drink.perPersonPerDay, 5000);

  // 한도 외의 규정은 그대로여야 한다. 키워드가 지워지면 분류 자체가 무너진다.
  check('식대 키워드는 그대로', next.meal.keywords, rules.meal.keywords);
  check('합산 기준은 그대로', next.meal.groupBy, rules.meal.groupBy);
  check('금지 사용처는 그대로', next.parking.bannedMerchants, rules.parking.bannedMerchants);

  // 기본 규정은 JSON 모듈이라 여러 요청이 함께 쓴다. 원본이 오염되면 안 된다.
  check('원본 규정은 오염되지 않는다', rules.meal.perPersonPerMeal, 12000);

  check('한도가 없으면 기본 규정 그대로', withLimits(rules, null), rules);
}

console.log('\n[3] 고친 한도로 판정하면 결과가 달라진다');
{
  // 1인 15,000원짜리 중식 한 건. 기본 한도(12,000)로는 3,000원 초과다.
  const rows = [row(10, '2026-04-15', 15000, '중식-홍길동')];

  const base = audit(file(rows), rules);
  check('기본 한도에서는 초과분 3,000원', base.rows[0].excess, 3000);
  check('기본 한도에서는 한도초과', base.rows[0].status, '한도초과');

  // 한도를 20,000원으로 올리면 같은 건이 정상이 된다.
  const raised = audit(file(rows), withLimits(rules, { mealPerPersonPerMeal: 20000, drinkPerPersonPerDay: 3000 }));
  check('한도를 올리면 정상', raised.rows[0].status, '정상');
  check('차감액이 사라진다', raised.totalDeduction, 0);
  check('표에 적히는 한도도 바뀐다', raised.rows[0].limit, 20000);

  // 한도를 10,000원으로 내리면 초과분이 커진다.
  const lowered = audit(file(rows), withLimits(rules, { mealPerPersonPerMeal: 10000, drinkPerPersonPerDay: 3000 }));
  check('한도를 내리면 초과분 5,000원', lowered.rows[0].excess, 5000);
  check('식대 초과 합계에 반영', lowered.mealExcess, 5000);
}

console.log('\n[4] 음료 한도도 같은 방식으로 적용된다');
{
  const rows = [row(10, '2026-04-15', 4000, '음료-홍길동', { merchant: '카페' })];

  check('기본 한도(3,000)에서는 1,000원 초과', audit(file(rows), rules).rows[0].excess, 1000);

  const raised = audit(file(rows), withLimits(rules, { mealPerPersonPerMeal: 12000, drinkPerPersonPerDay: 5000 }));
  check('5,000원으로 올리면 정상', raised.rows[0].status, '정상');
}

console.log('\n[5] 잘못된 한도는 막는다');
{
  check('0원', limitError(0, '식대') !== null, true);
  check('음수', limitError(-1, '식대') !== null, true);
  check('소수점', limitError(1200.5, '식대') !== null, true);
  check('숫자가 아님', limitError('12000', '식대') !== null, true);
  check('NaN', limitError(Number.NaN, '식대') !== null, true);
  check('상한 초과', limitError(LIMIT_MAX + 1, '식대') !== null, true);

  check('상한 자체는 통과', limitError(LIMIT_MAX, '식대'), null);
  check('정상값은 통과', limitError(12000, '식대'), null);

  // 오류 문구에 어느 항목인지가 들어가야 담당자가 어느 칸을 고칠지 안다.
  check('문구에 항목 이름이 들어간다', limitError(0, '음료').includes('음료'), true);

  check(
    '둘 중 하나만 틀려도 걸린다',
    limitsError({ mealPerPersonPerMeal: 12000, drinkPerPersonPerDay: 0 }) !== null,
    true,
  );
  check(
    '둘 다 정상이면 통과',
    limitsError({ mealPerPersonPerMeal: 12000, drinkPerPersonPerDay: 3000 }),
    null,
  );
}

console.log('\n[6] parseLimits — 요청으로 넘어온 값 받아들이기');
{
  check('없으면 null (기본 규정을 쓰라는 뜻)', parseLimits(undefined), null);
  check('null 도 null', parseLimits(null), null);

  check('정상 객체', parseLimits({ mealPerPersonPerMeal: 15000, drinkPerPersonPerDay: 4000 }), {
    mealPerPersonPerMeal: 15000,
    drinkPerPersonPerDay: 4000,
  });

  // JSON 으로 오가는 값이라 문자열로 올 수 있다. 숫자로 받아들인다.
  check('숫자 문자열도 받는다', parseLimits({ mealPerPersonPerMeal: '15000', drinkPerPersonPerDay: '4000' }), {
    mealPerPersonPerMeal: 15000,
    drinkPerPersonPerDay: 4000,
  });

  function throws(value) {
    try {
      parseLimits(value);
      return false;
    } catch {
      return true;
    }
  }

  check('객체가 아니면 예외', throws(12000), true);
  check('값이 빠지면 예외', throws({ mealPerPersonPerMeal: 12000 }), true);
  check('0원이면 예외', throws({ mealPerPersonPerMeal: 0, drinkPerPersonPerDay: 3000 }), true);
  check('빈 문자열이면 예외', throws({ mealPerPersonPerMeal: '', drinkPerPersonPerDay: 3000 }), true);
}

console.log('\n[7] sameLimits — 기본값과 같은지');
{
  const base = limitsOf(rules);
  check('같으면 true', sameLimits(base, limitsOf(rules)), true);
  check('식대가 다르면 false', sameLimits(base, { ...base, mealPerPersonPerMeal: 1 }), false);
  check('음료가 다르면 false', sameLimits(base, { ...base, drinkPerPersonPerDay: 1 }), false);
}

console.log(`\n결과: ${passed}건 통과, ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
