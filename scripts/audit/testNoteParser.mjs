/**
 * scripts/testNoteParser.mjs
 *
 * src/lib/noteParser.ts 검증 스크립트. 테스트 프레임워크 없이 node 로 바로 돌린다.
 *
 *   npm run test:note     (또는  node scripts/audit/testNoteParser.mjs)
 *
 * 확인하는 것은 세 가지다.
 *   1) 사양에 적힌 검증 예시가 그대로 나오는지
 *   2) 실제 파일에서 확인된 표기가 올바른 카테고리로 분류되는지
 *      (특히 "주유비-1742" 가 1742명이 되지 않는지)
 *   3) noteParser 의 키워드 기본값이 src/lib/audit/expenseRules.json 과 어긋나지 않는지
 *
 * 하나라도 실패하면 종료 코드 1 로 끝난다.
 */

import { readFileSync } from 'node:fs';

import { parseNote, DEFAULT_NOTE_KEYWORDS } from '../../src/lib/audit/noteParser.ts';

/* ------------------------------------------------------------------ */
/* 1) 인원 파싱 검증 예시 — 사양에 적힌 결과가 그대로 나와야 한다      */
/* ------------------------------------------------------------------ */

/** [사용내역, 카드소유자, 기대 참석자 목록] */
const PARTICIPANT_CASES = [
  ['중식-김서연', '김서연', ['김서연']],
  ['중식-김서연,최민호', '김서연', ['김서연', '최민호']],
  ['중식-김서연,목수1', '김서연', ['김서연', '목수#1']],
  ['중식-김서연,용역1인', '김서연', ['김서연', '용역#1']],
  ['음료 : 홍길동, 우청1', '홍길동', ['홍길동', '우청#1']],
  ['중식 : 홍길동, 우청2', '홍길동', ['홍길동', '우청#1', '우청#2']],
  ['음료 : 홍길동, 작업자2', '홍길동', ['홍길동', '작업자#1', '작업자#2']],
  ['음료구매-김서연,최민호', '김서연', ['김서연', '최민호']],
];

/* ------------------------------------------------------------------ */
/* 2) 실제 파일에 등장하는 표기 — 카테고리 판정과 실패 표시 확인       */
/* ------------------------------------------------------------------ */

/** [사용내역, 카드소유자, 기대 카테고리, 기대 mealKind(없으면 undefined), 기대 parseFailed] */
const CATEGORY_CASES = [
  ['중식-김서연', '김서연', 'meal', '중식', false],
  ['중식-김서연,최민호', '김서연', 'meal', '중식', false],
  ['중식-김서연,목수1', '김서연', 'meal', '중식', false],
  ['중식-김서연,용역1인', '김서연', 'meal', '중식', false],
  ['석식-김서연', '김서연', 'meal', '석식', false],
  ['음료구매-김서연,최민호', '김서연', 'drink', undefined, false],
  ['중식 : 홍길동', '홍길동', 'meal', '중식', false],
  ['중식: 홍길동', '홍길동', 'meal', '중식', false],
  ['음료 : 홍길동, 우청1', '홍길동', 'drink', undefined, false],
  ['음료 : 홍길동, 작업자2', '홍길동', 'drink', undefined, false],
  ['석식 : 홍길동, 정하윤', '홍길동', 'meal', '석식', false],
  // 아래부터는 판정 대상이 아니다 → 인원을 아예 파싱하지 않는다
  ['주차권구매', '홍길동', 'other', undefined, false],
  ['주차비 : 정하윤(자차)', '홍길동', 'other', undefined, false],
  // 순서를 뒤집으면 1742명으로 잡히는 위험 케이스
  ['주유비-1742', '홍길동', 'other', undefined, false],
  ['홍길동(택시 10:14): 대전역 → B마트 대전중구PPC', '홍길동', 'other', undefined, false],
  ['.', '홍길동', 'other', undefined, false],
];

/* ------------------------------------------------------------------ */
/* 3) 파싱 실패 처리 — 1명으로 넘겨짚지 않고 확인필요로 남기는지       */
/* ------------------------------------------------------------------ */

/** [사용내역, 카드소유자, 기대 parseFailed, 설명] */
const FAIL_CASES = [
  ['중식 홍길동', '홍길동', true, '구분자가 없어 인원을 알 수 없음'],
  ['중식-', '홍길동', false, '구분자 뒤가 비면 카드 소유자 1명'],
  ['중식-,,', '홍길동', true, '토큰이 전부 비어 있음'],
  ['중식-1742', '홍길동', true, '라벨 없는 맨 숫자는 인원으로 단정하지 않음'],
  ['중식-5인', '홍길동', false, '단위가 붙은 숫자는 인원으로 인정'],
  ['중식-작업자0', '홍길동', true, '0명은 오탐'],
  ['중식-작업자999', '홍길동', true, '비상식적으로 큰 수는 오탐'],
  ['중식-홍길동,010-1234-5678', '홍길동', true, '해석 못 한 토큰이 섞임'],
];

/* ------------------------------------------------------------------ */
/* 실행                                                                */
/* ------------------------------------------------------------------ */

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

console.log('\n[1] 인원 파싱 검증 예시');
for (const [note, owner, expected] of PARTICIPANT_CASES) {
  const result = parseNote(note, owner);
  check(
    `"${note}" → ${expected.length}명`,
    { participants: result.participants, parseFailed: result.parseFailed },
    { participants: expected, parseFailed: false },
  );
}

console.log('\n[2] 카테고리 판정 (실제 파일에 등장하는 표기)');
for (const [note, owner, category, mealKind, parseFailed] of CATEGORY_CASES) {
  const result = parseNote(note, owner);
  check(
    `"${note}" → ${category}${mealKind ? `/${mealKind}` : ''}`,
    { category: result.category, mealKind: result.mealKind, parseFailed: result.parseFailed },
    { category, mealKind, parseFailed },
  );
}

// "주유비-1742" 는 인원 파싱 자체가 돌지 않아야 한다. 참석자가 하나라도 나오면 순서가 뒤집힌 것이다.
console.log('\n[3] 처리 순서 안전장치');
{
  const result = parseNote('주유비-1742', '홍길동');
  check(
    '"주유비-1742" 는 인원을 파싱하지 않는다',
    { category: result.category, participants: result.participants },
    { category: 'other', participants: [] },
  );
}

console.log('\n[4] 파싱 실패 처리 (확인필요로 남기는지)');
for (const [note, owner, expected, why] of FAIL_CASES) {
  const result = parseNote(note, owner);
  check(`"${note}" → parseFailed=${expected} (${why})`, result.parseFailed, expected);
}

console.log('\n[5] 키워드 기본값이 src/lib/audit/expenseRules.json 과 같은지');
{
  const configUrl = new URL('../../src/lib/audit/expenseRules.json', import.meta.url);
  const rules = JSON.parse(readFileSync(configUrl, 'utf8'));

  check('meal.keywords', DEFAULT_NOTE_KEYWORDS.meal, rules.meal.keywords);
  check('drink.keywords', DEFAULT_NOTE_KEYWORDS.drink, rules.drink.keywords);

  // config 에 끼니가 추가됐는데 MealKind 유니온을 안 넓히면 여기서 걸린다.
  const KNOWN_MEAL_KINDS = ['조식', '중식', '석식'];
  const unknown = rules.meal.keywords.filter((k) => !KNOWN_MEAL_KINDS.includes(k));
  check('MealKind 유니온에 없는 끼니 키워드', unknown, []);
}

console.log(`\n결과: ${passed}건 통과, ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
