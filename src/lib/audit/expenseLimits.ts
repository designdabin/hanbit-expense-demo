/**
 * src/lib/expenseLimits.ts
 *
 * 화면에서 고칠 수 있는 한도(식대 1인 1식 · 음료 1인 1일)를 다루는 공용 모듈.
 *
 * [왜 한도만 따로 빼나]
 * src/lib/audit/expenseRules.json 은 규정의 단일 출처이고, 규정이 바뀌면 그 파일을 고치는 것이
 * 정석이다. 다만 담당자가 "이번 정산서만 다른 한도로 보고 싶다"(개정 전 시뮬레이션,
 * 예외 승인 건 확인)는 경우가 있어 **금액 두 개만** 화면에서 덮어쓸 수 있게 한다.
 *
 * 키워드·합산 기준·금지 사용처는 판정 결과의 성격 자체를 바꾸므로 화면에서 건드리지 않는다.
 *
 * [저장하지 않는다]
 * 고친 한도는 서버에 저장하지 않고 요청마다 함께 보낸다. 검증 API 와 리포트 API 가
 * 같은 한도를 받아야 화면 숫자와 엑셀 숫자가 어긋나지 않기 때문이다.
 * (영구 저장이 필요해지면 별도 저장소를 붙여야 한다. config JSON 을 서버가 덮어쓰면
 *  읽기 전용 파일 시스템에 배포했을 때 깨진다)
 *
 * [독립 모듈 규칙]
 * 파일 시스템을 읽지 않는다. 기본 규정 객체는 호출하는 쪽에서 넘겨준다.
 */

import type { ExpenseRulesConfig } from './expenseRules';

/** 화면에서 고칠 수 있는 한도 두 개 */
export interface EditableLimits {
  /** 식대 1인 1식 한도 (원) */
  mealPerPersonPerMeal: number;
  /** 음료 1인 1일 한도 (원) */
  drinkPerPersonPerDay: number;
}

/** 한도 입력값이 넘을 수 없는 상한. 오타로 0 을 더 붙이는 사고를 막는다. */
export const LIMIT_MAX = 1_000_000;

/**
 * 규정 객체에서 지금 적용 중인 한도를 꺼낸다.
 *
 * 인자를 ExpenseRulesConfig 가 아니라 **필요한 두 값만** 요구하는 모양으로 받는다.
 * 화면은 src/lib/audit/expenseRules.json 을 그대로 넘기는데, JSON 모듈의 groupBy 는
 * string[] 로 넓혀져 ExpenseRulesConfig 와 바로 맞지 않기 때문이다.
 * (서버는 validateRulesConfig 로 좁히지만, 한도를 읽는 데는 검증이 필요 없다)
 */
export function limitsOf(rules: {
  meal: { perPersonPerMeal: number };
  drink: { perPersonPerDay: number };
}): EditableLimits {
  return {
    mealPerPersonPerMeal: rules.meal.perPersonPerMeal,
    drinkPerPersonPerDay: rules.drink.perPersonPerDay,
  };
}

/**
 * 기본 규정에 고친 한도를 덮어쓴 새 규정 객체를 만든다.
 *
 * 원본 객체는 건드리지 않는다. (기본값은 JSON 모듈이라 여러 요청이 함께 쓴다)
 * limits 가 없으면 기본 규정을 그대로 돌려준다.
 */
export function withLimits(
  rules: ExpenseRulesConfig,
  limits?: EditableLimits | null,
): ExpenseRulesConfig {
  if (!limits) return rules;

  return {
    ...rules,
    meal: { ...rules.meal, perPersonPerMeal: limits.mealPerPersonPerMeal },
    drink: { ...rules.drink, perPersonPerDay: limits.drinkPerPersonPerDay },
  };
}

/** 두 한도가 같은지 (기본값과 견줘 "고쳤음"을 표시할 때 쓴다) */
export function sameLimits(a: EditableLimits, b: EditableLimits): boolean {
  return (
    a.mealPerPersonPerMeal === b.mealPerPersonPerMeal &&
    a.drinkPerPersonPerDay === b.drinkPerPersonPerDay
  );
}

/**
 * 한도 한 개가 쓸 수 있는 값인지 확인하고, 안 되면 그 이유를 돌려준다.
 *
 * 화면은 이 메시지를 입력칸 아래에 그대로 보여 주고, API 는 400 으로 돌려보낸다.
 * 두 곳이 같은 함수를 쓰므로 화면에서 통과한 값이 서버에서 막히는 일이 없다.
 *
 * @returns 문제가 없으면 null
 */
export function limitError(value: unknown, label: string): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${label} 한도를 숫자로 입력해 주세요.`;
  }
  if (!Number.isInteger(value)) {
    return `${label} 한도는 원 단위 정수로 입력해 주세요.`;
  }
  if (value <= 0) {
    return `${label} 한도는 0원보다 커야 해요.`;
  }
  if (value > LIMIT_MAX) {
    return `${label} 한도가 너무 커요. ${LIMIT_MAX.toLocaleString('ko-KR')}원 이하로 입력해 주세요.`;
  }
  return null;
}

/** 한도 두 개를 한꺼번에 확인한다. 문제가 없으면 null. */
export function limitsError(limits: EditableLimits): string | null {
  return (
    limitError(limits.mealPerPersonPerMeal, '식비') ??
    limitError(limits.drinkPerPersonPerDay, '음료')
  );
}

/**
 * 요청 본문으로 넘어온 값을 한도로 받아들인다.
 *
 * 값이 아예 없으면 null (기본 규정을 쓰라는 뜻)이고,
 * 모양이 틀렸거나 범위를 벗어나면 Error 를 던진다.
 */
export function parseLimits(value: unknown): EditableLimits | null {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'object') {
    throw new Error('한도는 숫자로 입력해 주세요.');
  }

  const raw = value as Partial<Record<keyof EditableLimits, unknown>>;
  const limits: EditableLimits = {
    mealPerPersonPerMeal: Number(raw.mealPerPersonPerMeal),
    drinkPerPersonPerDay: Number(raw.drinkPerPersonPerDay),
  };

  const error = limitsError(limits);
  if (error) throw new Error(error);

  return limits;
}
