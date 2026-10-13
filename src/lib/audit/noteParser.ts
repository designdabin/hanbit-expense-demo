/**
 * src/lib/noteParser.ts
 *
 * 을지 P열(사용내역)에서 "무슨 항목인지"와 "몇 명이 먹었는지"를 뽑아낸다.
 * P열은 직원이 손으로 쓴 자유 서술이라 사람마다 표기가 다르다.
 *
 * [처리 순서 — 절대 바꾸지 말 것]
 *   1) 먼저 카테고리를 판정한다
 *   2) 카테고리가 식대(meal) 또는 음료(drink)일 때만 인원을 파싱한다
 *
 * 순서를 뒤집으면 "주유비-1742" 의 1742 를 인원 수로 읽어 1742명이 된다.
 * 실제 파일에 존재하는 표기라 반드시 카테고리로 먼저 걸러야 한다.
 *
 * [파싱 실패는 실패로 남긴다]
 * 카테고리는 식대/음료인데 인원을 판별할 수 없으면 절대 "1명"으로 넘겨짚지 않는다.
 * parseFailed: true 로 표시해 화면에서 "확인필요"로 따로 보여준다.
 * 실패를 정상으로 처리하면 위반이 조용히 누락된다.
 *
 * [독립 모듈 규칙]
 * 외부 라이브러리와 환경 의존 API(next/*, React, fs)를 쓰지 않는 순수 함수 모듈이다.
 * 어떤 프로젝트로든 폴더째 옮길 수 있다.
 */

/* ------------------------------------------------------------------ */
/* 출력 타입                                                           */
/* ------------------------------------------------------------------ */

/** 끼니 종류. src/lib/audit/expenseRules.json 의 meal.keywords 와 짝을 이룬다. */
export type MealKind = '조식' | '중식' | '석식';

/** 사용내역 한 줄의 파싱 결과 */
export interface ParsedNote {
  /** 판정 대상 분류. other 는 규정 판정 대상이 아니다. */
  category: 'meal' | 'drink' | 'other';
  /** 식대일 때만 채워진다 */
  mealKind?: MealKind;
  /** 펼쳐진 참석자 목록 (예: 인원 2명이면 원소 2개) */
  participants: string[];
  /** 인원을 판별하지 못했으면 true → 화면에서 "확인필요"로 표시 */
  parseFailed: boolean;
  /** P열 원문 */
  raw: string;
}

/**
 * 카테고리 판정에 쓰는 키워드.
 * src/lib/audit/expenseRules.json 의 meal.keywords / drink.keywords 와 같은 값이다.
 */
export interface NoteKeywords {
  meal: readonly string[];
  drink: readonly string[];
}

/**
 * 키워드 기본값.
 *
 * src/lib/ 은 파일 시스템을 읽지 않으므로(폴더째 옮길 수 있어야 한다) 여기에 기본값을 둔다.
 * 규정 JSON 과 값이 어긋나면 scripts/testNoteParser.mjs 의 대조 검사에서 실패한다.
 * 호출하는 쪽에서 config 를 읽어 세 번째 인자로 넘기면 JSON 이 그대로 단일 출처가 된다.
 */
export const DEFAULT_NOTE_KEYWORDS: NoteKeywords = {
  meal: ['조식', '중식', '석식'],
  drink: ['음료'],
};

/* ------------------------------------------------------------------ */
/* 인원 파싱 규칙 상수                                                 */
/* ------------------------------------------------------------------ */

/**
 * 인원을 구분하는 구분자. "-" 와 ":" 두 가지를 쓰며 " : " 처럼 공백이 끼어도 ":" 로 잡힌다.
 * 맨 처음 나오는 구분자 1개에서만 자른다. (뒤쪽에 또 나와도 무시)
 */
const SEPARATOR = /[-:]/;

/**
 * 토큰 끝에 붙은 숫자를 잡는다. 뒤에 "인"/"명" 이 붙어도 무관하다.
 *   "목수1" → 목수 / 1,  "용역1인" → 용역 / 1,  "작업자2" → 작업자 / 2
 * 앞 글자(소속·직군)는 해석하지 않고 인원 수만 쓴다.
 */
const COUNT_TOKEN = /^(.*?)(\d+)\s*(인|명)?$/;

/** 이름 없이 숫자만 적힌 경우("5인")에 쓸 참석자 라벨 */
const ANONYMOUS_LABEL = '인원';

/**
 * 토큰 하나가 나타낼 수 있는 최대 인원.
 * 이보다 크면 오탐(전화번호·금액 등)으로 보고 실패 처리한다.
 */
const MAX_PER_TOKEN = 100;

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */

/**
 * 사용내역 한 줄을 파싱한다.
 *
 * @param note P열 원문
 * @param ownerName 카드 소유자(담당자) 성명. 구분자 뒤가 비어 있을 때 참석자로 쓴다.
 * @param keywords 카테고리 판정 키워드. 생략하면 규정 JSON 과 같은 기본값을 쓴다.
 */
export function parseNote(
  note: string,
  ownerName: string,
  keywords: NoteKeywords = DEFAULT_NOTE_KEYWORDS,
): ParsedNote {
  const raw = note ?? '';

  // ── 1단계: 카테고리 판정 ────────────────────────────────────────
  // 반드시 인원 파싱보다 먼저 한다. ("주유비-1742" 가 1742명이 되는 것을 막는다)
  const category = detectCategory(raw, keywords);

  // 판정 대상이 아니면 인원을 아예 건드리지 않는다.
  if (category.category === 'other') {
    return { category: 'other', participants: [], parseFailed: false, raw };
  }

  // ── 2단계: 식대·음료일 때만 인원 파싱 ───────────────────────────
  const { participants, parseFailed } = parseParticipants(raw, ownerName);

  return { ...category, participants, parseFailed, raw };
}

/* ------------------------------------------------------------------ */
/* 1단계 — 카테고리 판정                                               */
/* ------------------------------------------------------------------ */

/**
 * 문자열 **시작** 기준으로 카테고리를 판정한다.
 *   "조식/중식/석식" 으로 시작 → meal (매칭된 키워드가 그대로 mealKind)
 *   "음료" 로 시작            → drink ("음료구매" 도 시작이 "음료"라 포함된다)
 *   그 외                     → other (판정 대상 아님)
 *
 * "중식 : 홍길동" 처럼 키워드 뒤에 공백이 오거나 "중 식" 처럼 글자 사이에 공백이
 * 들어간 경우까지 잡기 위해 공백을 제거한 문자열로 비교한다.
 */
function detectCategory(
  raw: string,
  keywords: NoteKeywords,
): { category: 'meal'; mealKind: MealKind } | { category: 'drink' } | { category: 'other' } {
  const compact = raw.replace(/\s/g, '');

  const meal = keywords.meal.find((keyword) => compact.startsWith(keyword));
  // config 에 새 끼니가 추가되면 MealKind 유니온도 함께 넓혀야 한다.
  // (scripts/testNoteParser.mjs 가 JSON 과 유니온이 어긋나는지 검사한다)
  if (meal) return { category: 'meal', mealKind: meal as MealKind };

  if (keywords.drink.some((keyword) => compact.startsWith(keyword))) {
    return { category: 'drink' };
  }

  return { category: 'other' };
}

/* ------------------------------------------------------------------ */
/* 2단계 — 인원 파싱                                                   */
/* ------------------------------------------------------------------ */

/**
 * 구분자 뒤의 참석자 목록을 펼친다.
 *
 * 판별하지 못한 토큰이 하나라도 있으면 parseFailed 를 세운다.
 * 이때도 읽어낸 참석자는 그대로 돌려준다. 화면에서 원문과 함께 보여주면
 * 사람이 무엇이 빠졌는지 바로 대조할 수 있기 때문이다.
 */
function parseParticipants(
  raw: string,
  ownerName: string,
): { participants: string[]; parseFailed: boolean } {
  // 맨 처음 나오는 구분자 1개에서만 자른다. (뒤쪽 구분자는 이름의 일부일 수 있다)
  const match = raw.match(SEPARATOR);
  if (!match || match.index === undefined) {
    // 구분자가 없으면 인원을 알 수 없다. 1명으로 넘겨짚지 않는다.
    return { participants: [], parseFailed: true };
  }

  const after = raw.slice(match.index + 1).trim();

  // 구분자 뒤가 비어 있으면("석식-") 카드 소유자 1명으로 본다.
  if (after === '') {
    const owner = ownerName?.trim() ?? '';
    // 소유자 이름조차 모르면 참석자를 만들어낼 수 없으므로 실패로 남긴다.
    return owner === ''
      ? { participants: [], parseFailed: true }
      : { participants: [owner], parseFailed: false };
  }

  // 쉼표로 토큰을 나눈다. 빈 토큰("홍길동," 처럼 끝에 쉼표가 붙은 경우)은 버린다.
  const tokens = after
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');

  if (tokens.length === 0) {
    return { participants: [], parseFailed: true };
  }

  const participants: string[] = [];
  let parseFailed = false;

  for (const token of tokens) {
    const expanded = expandToken(token);
    if (expanded === null) {
      parseFailed = true; // 해석 못 한 토큰 → 확인필요
      continue;
    }
    participants.push(...expanded);
  }

  return { participants, parseFailed };
}

/**
 * 토큰 하나를 참석자 목록으로 펼친다. 해석하지 못하면 null.
 *
 *   숫자가 끝에 붙은 토큰  → 그 숫자만큼의 인원. "우청2" → ["우청#1","우청#2"]
 *   숫자가 없는 토큰      → 실명으로 보고 1명. "김영호" → ["김영호"]
 *   그 밖(숫자가 중간에 섞임, 0명, 비상식적으로 큰 수) → null (확인필요)
 */
function expandToken(token: string): string[] | null {
  const match = token.match(COUNT_TOKEN);

  if (!match) {
    // 끝자리 숫자 규칙에 맞지 않는데 숫자가 섞여 있으면 사람 이름으로 단정할 수 없다.
    if (/\d/.test(token)) return null;
    // 숫자가 전혀 없으면 실명으로 보고 1명. 토큰을 그대로 참석자 이름으로 쓴다.
    return [token];
  }

  const count = Number(match[2]);
  const hasUnit = match[3] !== undefined; // "인"/"명" 이 붙어 있었는지
  // 앞 글자에 붙은 구분 기호("홍길동 ·" 같은 잔여물)를 정리한다.
  let label = match[1].trim().replace(/[·ㆍ、/]+$/, '').trim();

  // 0명이거나 비상식적으로 큰 수는 오탐으로 보고 실패 처리한다.
  if (!Number.isFinite(count) || count <= 0 || count > MAX_PER_TOKEN) return null;

  if (label === '') {
    // 라벨 없이 숫자만 있는 토큰("1742")은 인원인지 아닌지 알 수 없어 실패로 남긴다.
    // 단 "5인"/"5명" 처럼 단위가 붙어 있으면 인원 표기가 분명하므로 인정한다.
    if (!hasUnit) return null;
    label = ANONYMOUS_LABEL;
  }

  // "우청#1", "우청#2" 처럼 번호를 붙여 개별 참석자로 펼친다.
  return Array.from({ length: count }, (_, index) => `${label}#${index + 1}`);
}
