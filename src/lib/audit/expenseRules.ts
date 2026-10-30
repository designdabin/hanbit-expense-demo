/**
 * src/lib/expenseRules.ts
 *
 * 정산서 파싱 결과(SettlementFile)와 사용 목적 파싱 결과(ParsedNote)를 받아 규정 위반을 판정한다.
 *
 * [한도값은 코드가 아니라 JSON]
 * 한도 금액·금지 가맹점·금지 문구는 이 파일에 숫자로 박지 않는다. 전부
 * src/lib/audit/expenseRules.json 에서 읽어 인자로 받는다. 규정이 바뀌면 JSON만 고치면 된다.
 *
 * [항목으로 필터링하지 않는다]
 * 실제 파일에는 항목이 잘못 적힌 사례가 있다(주차비가 복리후생비로 들어간 경우).
 * 따라서 항목 열(SettlementRow.item)은 판정에 일절 쓰지 않고, 분류는 반드시
 * 사용 목적(SettlementRow.note) 텍스트를 기준으로 한다.
 *
 * [독립 모듈 규칙]
 * 파일 시스템을 직접 읽지 않는다. 규정 객체는 호출하는 쪽에서 넘겨준다.
 */

import { parseNote, type ParsedNote } from './noteParser';
// 타입만 가져온다. (settlementParser 는 xlsx 에 의존하므로 런타임 의존을 만들지 않는다)
import type { SettlementFile, SettlementRow } from './settlementParser';

/* ------------------------------------------------------------------ */
/* 규정 설정 타입                                                      */
/* ------------------------------------------------------------------ */

/** 그룹 합산 기준으로 쓸 수 있는 키 */
export type GroupKey = 'date' | 'mealKind' | 'person';

/** 식대 규정 — 조식/중식/석식별로 1인 1식 한도를 본다 */
export interface MealRule {
  /** 사용내역에서 식사 건을 골라낼 키워드 (그대로 mealKind 값이 된다) */
  keywords: string[];
  /** 1인 1식 한도 (원) */
  perPersonPerMeal: number;
  /** 합산 기준: 같은 날·같은 끼니·같은 사람끼리 묶어 한도와 비교한다 */
  groupBy: GroupKey[];
}

/** 음료 규정 — 하루 단위로 1인 한도를 본다 */
export interface DrinkRule {
  /** 사용내역에서 음료 건을 골라낼 키워드 */
  keywords: string[];
  /** 1인 1일 한도 (원) */
  perPersonPerDay: number;
  /** 합산 기준: 같은 날·같은 사람끼리 묶어 한도와 비교한다 */
  groupBy: GroupKey[];
}

/** 주차 규정 — 금지 사용처·금지 문구에 걸리면 전액을 문제로 본다 */
export interface ParkingRule {
  /** 사용이 금지된 가맹점명 (사용처와 부분일치로 대조) */
  bannedMerchants: string[];
  /** 사용내역에 있으면 안 되는 문구 (부분일치) */
  bannedNoteKeywords: string[];
  /** fullAmount = 한도 초과분이 아니라 결제 전액을 위반 금액으로 잡는다 */
  mode: 'fullAmount';
}

/** src/lib/audit/expenseRules.json 전체 구조 */
export interface ExpenseRulesConfig {
  meal: MealRule;
  drink: DrinkRule;
  parking: ParkingRule;
}

/* ------------------------------------------------------------------ */
/* 판정 결과 타입                                                      */
/* ------------------------------------------------------------------ */

/** 판정된 지출 한 건 */
export interface Violation {
  /** 엑셀 실제 행 번호 (원본 대조용) */
  rowNumber: number;
  date: string;
  /** '기타' 는 규정 판정 대상이 아닌 지출(주유비·물품구입 등) */
  category: '식대' | '음료' | '주차비' | '기타';
  /** 식대일 때만 채워진다 */
  mealKind?: string;
  merchant: string;
  /** 사용 목적 원문 */
  note: string;
  paymentMethod: string;
  /** 펼쳐진 참석자 목록 */
  participants: string[];
  /** 결제금액 */
  amount: number;
  /** 인당 분배액 (원 미만 버림 기준) */
  perPersonAmount: number;
  /** 적용 한도. 주차 금지항목은 한도 개념이 없어 0 */
  limit: number;
  /** 초과금액 (금지항목은 결제 전액) */
  excess: number;
  status: '정상' | '한도초과' | '금지항목' | '확인필요';
}

/** 사람·일자 단위 집계 한 줄 */
export interface PersonSummary {
  /** 참석자 이름 */
  person: string;
  date: string;
  /** '식대(중식)' 처럼 끼니까지 표시한다 */
  category: string;
  /** 그룹 합산액 */
  total: number;
  limit: number;
  excess: number;
}

/** 파일 하나의 판정 결과 */
export interface AuditResult {
  ownerName: string;
  usagePeriod: string;
  /** 개인카드 합계 (정산서 요약) */
  personalCardTotal: number;
  /** 검사한 지출 건수 (정산서에서 읽은 전체 행 수) */
  totalChecked: number;
  /** 식대 초과 합계 */
  mealExcess: number;
  /** 음료 초과 합계 */
  drinkExcess: number;
  /** 주차 금지항목 전액 합계 */
  parkingBanned: number;
  /** 차감 대상 총액 = mealExcess + drinkExcess + parkingBanned */
  totalDeduction: number;
  /**
   * 정산서의 **모든 행**에 대한 판정 결과 (정상·판정대상아님 포함, 행 번호 순).
   * 화면에서 원본과 나란히 놓고 보기 위한 목록이다.
   */
  rows: Violation[];
  /** 위반으로 판정된 건 (한도초과 + 금지항목) */
  violations: Violation[];
  /** 사람·일자 단위 집계 (한도 이내인 그룹도 모두 포함) */
  byPerson: PersonSummary[];
  /** 참고용 주차 내역 — 위반은 아니지만 눈으로 확인할 것 */
  parkingReference: Violation[];
  /** 인원 파싱에 실패해 판정하지 못한 건 */
  needsReview: Violation[];
}

/* ------------------------------------------------------------------ */
/* 판정에 쓰는 상수                                                    */
/* ------------------------------------------------------------------ */

/**
 * 주차 관련 건을 참고 목록으로 분리할 때 쓰는 분류 힌트.
 *
 * 한도값이나 금지 목록이 아니라 "어떤 행을 주차 관련으로 볼지" 를 정하는 낱말이라
 * 코드에 둔다. 금지 대상(누리파크 / 주차권구매)은 전부 JSON 에서 온다.
 */
const PARKING_HINTS = ['주차'];

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */

/** 판정 옵션 */
export interface AuditOptions {
  /**
   * 행 번호 → 손으로 고친 참석자 목록.
   *
   * 사용내역 표기가 제각각이라 인원을 못 읽는 행이 나온다. 화면에서 담당자가 직접
   * 참석자를 채워 넣으면 그 값으로 다시 판정한다.
   * 키가 없으면 "수정 없음", 빈 배열이면 "참석자를 지웠다"는 뜻이라 확인필요가 된다.
   * (원본 엑셀은 그대로 두고, 판정만 다시 한다)
   */
  participantOverrides?: Record<number, string[]>;
}

/**
 * 경비 정산서 한 건을 규정과 대조해 판정한다.
 *
 * @param file src/lib/euljiParser.ts 의 파싱 결과
 * @param rules src/lib/audit/expenseRules.json 내용 (호출하는 쪽에서 읽어 넘긴다)
 * @param options 참석자 수정 등 판정 옵션
 */
export function audit(
  file: SettlementFile,
  rules: ExpenseRulesConfig,
  options: AuditOptions = {},
): AuditResult {
  validateRulesConfig(rules);

  const overrides = options.participantOverrides ?? {};

  // ── 1단계: 행을 분류한다. 이 단계에서는 아직 한도를 보지 않는다. ──
  const classified: ClassifiedRow[] = file.rows.map((row) => {
    // 분류는 반드시 사용 목적(row.note) 기준. 항목(row.item)은 보지 않는다.
    const parsed = parseNote(row.note, file.ownerName, {
      meal: rules.meal.keywords,
      drink: rules.drink.keywords,
    });

    if (parsed.category === 'meal' || parsed.category === 'drink') {
      const isMeal = parsed.category === 'meal';
      const category = isMeal ? '식대' : '음료';
      const limit = isMeal ? rules.meal.perPersonPerMeal : rules.drink.perPersonPerDay;

      // 화면에서 고친 참석자가 있으면 그것을 쓴다.
      // 이름을 채워 넣었으면 파싱 실패가 해소된 것으로 보고, 다 지웠으면 다시 확인필요가 된다.
      const override = overrides[row.rowNumber];
      const resolved: ParsedNote = Array.isArray(override)
        ? { ...parsed, participants: override, parseFailed: override.length === 0 }
        : parsed;

      // 인원을 판별하지 못했으면 절대 넘겨짚지 않고 "확인필요"로 뺀다.
      // 여기서 1명으로 가정하면 위반이 조용히 누락된다.
      const unresolved = resolved.parseFailed || resolved.participants.length === 0;

      return { row, parsed: resolved, kind: unresolved ? 'unresolved' : category, category, limit };
    }

    // 식대·음료가 아닌 행에서 주차 관련 건을 가려낸다.
    if (isBannedParking(row, rules.parking)) {
      // 금지 사용처 + 금지 문구 → 금액 무관 전액 위반. 한도 개념이 없다.
      return { row, parsed, kind: 'parkingBanned', category: '주차비', limit: 0 };
    }
    if (isParkingRelated(row)) {
      // 그 밖의 주차 결제는 위반으로 잡지 않고 참고 목록으로만 분리한다.
      return { row, parsed, kind: 'parkingReference', category: '주차비', limit: 0 };
    }

    // 규정 판정 대상이 아닌 지출 (주유비·물품구입 등)
    return { row, parsed, kind: 'other', category: '기타', limit: 0 };
  });

  // ── 2단계: 식대·음료를 인·단위로 합산해 한도와 비교한다. ────────
  // 그룹 키만 다르고 판정 로직이 같으므로 공통 함수로 처리한다.
  const mealJudged = judgeByGroup(classified.filter((c) => c.kind === '식대'), {
    category: '식대',
    limit: rules.meal.perPersonPerMeal,
    groupBy: rules.meal.groupBy,
  });
  const drinkJudged = judgeByGroup(classified.filter((c) => c.kind === '음료'), {
    category: '음료',
    limit: rules.drink.perPersonPerDay,
    groupBy: rules.drink.groupBy,
  });

  // ── 3단계: 모든 행을 판정 결과로 옮긴다 (정상 행 포함). ─────────
  const excessByRow = new Map([...mealJudged.excessByRow, ...drinkJudged.excessByRow]);

  const rows: Violation[] = classified.map(({ row, parsed, kind, category, limit }) => {
    if (kind === 'unresolved') {
      return toViolation(row, parsed, category, limit, 0, '확인필요');
    }
    if (kind === 'parkingBanned') {
      return toViolation(row, parsed, category, 0, row.amount, '금지항목');
    }
    if (kind === 'parkingReference' || kind === 'other') {
      return toViolation(row, parsed, category, 0, 0, '정상');
    }

    // 식대·음료 — 그룹 판정에서 이 행에 배정된 초과액을 가져온다.
    const excess = excessByRow.get(row.rowNumber) ?? 0;
    return toViolation(row, parsed, category, limit, excess, excess > 0 ? '한도초과' : '정상');
  });

  const mealExcess = sum(
    rows.filter((v) => v.category === '식대').map((v) => v.excess),
  );
  const drinkExcess = sum(
    rows.filter((v) => v.category === '음료').map((v) => v.excess),
  );
  const parkingBanned = sum(
    rows.filter((v) => v.status === '금지항목').map((v) => v.excess),
  );

  return {
    ownerName: file.ownerName,
    usagePeriod: file.usagePeriod,
    personalCardTotal: file.personalCardTotal,
    totalChecked: file.rows.length,
    mealExcess,
    drinkExcess,
    parkingBanned,
    totalDeduction: mealExcess + drinkExcess + parkingBanned,
    rows,
    violations: rows.filter((v) => v.status === '한도초과' || v.status === '금지항목'),
    byPerson: [...mealJudged.byPerson, ...drinkJudged.byPerson].sort(comparePersonSummary),
    // 참고용 주차 = 금지항목이 아닌 주차 관련 건
    parkingReference: rows.filter((v) => v.category === '주차비' && v.status === '정상'),
    needsReview: rows.filter((v) => v.status === '확인필요'),
  };
}

/* ------------------------------------------------------------------ */
/* 식대·음료 공통 판정 (그룹 키만 다르다)                              */
/* ------------------------------------------------------------------ */

/** 분류가 끝난 행 — 사용내역 파싱 결과와 적용 한도를 함께 들고 다닌다 */
interface ClassifiedRow {
  row: SettlementRow;
  parsed: ParsedNote;
  /** 합산 판정 대상이면 '식대'|'음료', 아니면 처리 방식 */
  kind: '식대' | '음료' | 'unresolved' | 'parkingBanned' | 'parkingReference' | 'other';
  category: Violation['category'];
  limit: number;
}

/** 참석자 한 명에게 분배된 금액 한 조각 */
interface Share {
  row: SettlementRow;
  parsed: ParsedNote;
  person: string;
  amount: number;
}

/**
 * 인·단위 합산 판정.
 *
 * 식대(일자+끼니+사람)와 음료(일자+사람)는 그룹 키만 다르고 계산이 같으므로
 * 이 함수 하나로 처리한다. 그룹 키는 config 의 groupBy 배열을 그대로 따른다.
 *
 *   1) 각 행의 금액을 참석자 수로 균등 분배한다
 *   2) groupBy 로 만든 키별로 분배액을 합산한다
 *   3) 합산액이 한도를 넘으면 초과분 = 합산액 - 한도
 */
function judgeByGroup(
  rows: ClassifiedRow[],
  options: { category: '식대' | '음료'; limit: number; groupBy: GroupKey[] },
): { excessByRow: Map<number, number>; byPerson: PersonSummary[] } {
  const { category, limit, groupBy } = options;

  // ── 1) 행 금액을 참석자에게 균등 분배 ──────────────────────────
  const shares: Share[] = [];
  for (const { row, parsed } of rows) {
    const amounts = splitEvenly(row.amount, parsed.participants.length);
    parsed.participants.forEach((person, index) => {
      shares.push({ row, parsed, person, amount: amounts[index] });
    });
  }

  // ── 2) groupBy 키로 묶어 합산 ──────────────────────────────────
  const groups = new Map<string, Share[]>();
  for (const share of shares) {
    const key = groupKeyOf(share, groupBy);
    const bucket = groups.get(key);
    if (bucket) bucket.push(share);
    else groups.set(key, [share]);
  }

  // ── 3) 그룹별로 한도와 비교 ────────────────────────────────────
  const byPerson: PersonSummary[] = [];
  // 행 단위 초과액. 같은 행이 여러 참석자·여러 그룹에 걸릴 수 있어 행 번호로 누적한다.
  const excessByRow = new Map<number, number>();

  for (const bucket of groups.values()) {
    const total = sum(bucket.map((s) => s.amount));
    const excess = Math.max(0, total - limit);
    const head = bucket[0];

    byPerson.push({
      person: head.person,
      date: head.row.date,
      // 같은 날 조식·중식·석식이 섞이면 구분이 안 되므로 끼니를 함께 표시한다.
      category: head.parsed.mealKind ? `${category}(${head.parsed.mealKind})` : category,
      total,
      limit,
      excess,
    });

    if (excess === 0) continue;

    // 그룹 초과액을 행에 되돌려 붙인다. 행 번호 순으로 누적하다가 한도를 넘어선
    // 시점부터의 금액을 그 행의 초과액으로 본다. (한도를 넘긴 행이 어디인지 드러난다)
    let cumulative = 0;
    for (const share of [...bucket].sort((a, b) => a.row.rowNumber - b.row.rowNumber)) {
      const before = cumulative;
      cumulative += share.amount;
      const rowExcess = Math.max(0, cumulative - limit) - Math.max(0, before - limit);
      if (rowExcess > 0) {
        excessByRow.set(share.row.rowNumber, (excessByRow.get(share.row.rowNumber) ?? 0) + rowExcess);
      }
    }
  }

  return { excessByRow, byPerson };
}

/**
 * 금액을 인원수로 균등 분배한다.
 * 원 미만은 버리고, 남은 잔여 원은 첫 번째 참석자에게 더해 총액을 원본과 정확히 맞춘다.
 *   예) 46,000원 / 3명 → [15334, 15333, 15333]
 */
function splitEvenly(amount: number, count: number): number[] {
  if (count <= 0) return [];

  const base = Math.floor(amount / count);
  const shares = new Array<number>(count).fill(base);
  // 버림 때문에 생긴 잔여(0~count-1원)를 첫 번째 참석자가 떠안는다.
  shares[0] += amount - base * count;

  return shares;
}

/**
 * config 의 groupBy 배열대로 그룹 키를 만든다.
 * 식대는 ["date","mealKind","person"], 음료는 ["date","person"] 이다.
 */
function groupKeyOf(share: Share, groupBy: GroupKey[]): string {
  return groupBy
    .map((key) => {
      if (key === 'date') return share.row.date;
      if (key === 'mealKind') return share.parsed.mealKind ?? '';
      return share.person;
    })
    .join('|');
}

/* ------------------------------------------------------------------ */
/* 주차 판정                                                           */
/* ------------------------------------------------------------------ */

/**
 * 금지 주차 결제인지 본다.
 * 사용처에 금지 가맹점이 **포함**되고 사용 목적에 금지 문구가 **포함**되면 위반이다.
 * 부분일치라 "강서누리파크" 처럼 앞뒤에 글자가 붙어도 자동으로 잡힌다.
 */
function isBannedParking(row: SettlementRow, rule: ParkingRule): boolean {
  const merchant = compact(row.merchant);
  const note = compact(row.note);

  const merchantHit = rule.bannedMerchants.some((banned) => merchant.includes(compact(banned)));
  const noteHit = rule.bannedNoteKeywords.some((banned) => note.includes(compact(banned)));

  return merchantHit && noteHit;
}

/** 위반은 아니지만 참고 목록에 담을 주차 관련 결제인지 본다. */
function isParkingRelated(row: SettlementRow): boolean {
  const haystack = compact(`${row.note} ${row.merchant}`);
  return PARKING_HINTS.some((hint) => haystack.includes(hint));
}

/* ------------------------------------------------------------------ */
/* 신청 기간                                                           */
/* ------------------------------------------------------------------ */

/**
 * 정산서가 어느 달 것인지 알아낸다.
 *
 * 경비 정산서는 한 달 단위로 작성하므로 판정도 표시도 월 기준이다.
 * 1순위: 정산서의 사용 기간 ("2026. 03. 01 ~ 31" → 2026년 3월)
 * 2순위: 판정된 행의 일자 ("2026-03-09" → 2026년 3월)
 * 둘 다 없으면 null. (화면·파일명에서 각자 대체 문구를 쓴다)
 *
 * 화면과 리포트 파일명이 같은 규칙을 쓰도록 여기 한 곳에만 둔다.
 */
export function resolvePeriodMonth(
  source: Pick<AuditResult, 'usagePeriod' | 'rows'>,
): { year: string; month: string } | null {
  // "2026. 03. 01" / "2026-03-01" / "2026/3/1" 형태에서 연-월을 집는다.
  const matched = source.usagePeriod?.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})/);
  if (matched) return { year: matched[1], month: matched[2].padStart(2, '0') };

  const date = source.rows.find((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))?.date;
  return date ? { year: date.slice(0, 4), month: date.slice(5, 7) } : null;
}

/* ------------------------------------------------------------------ */
/* 공용 헬퍼                                                           */
/* ------------------------------------------------------------------ */

/** 판정 결과 한 줄을 만든다. */
function toViolation(
  row: SettlementRow,
  parsed: ParsedNote,
  category: Violation['category'],
  limit: number,
  excess: number,
  status: Violation['status'],
): Violation {
  const participants = parsed.participants;

  return {
    rowNumber: row.rowNumber,
    date: row.date,
    category,
    // 식대가 아니면 끼니 종류가 없다.
    ...(parsed.mealKind ? { mealKind: parsed.mealKind } : {}),
    merchant: row.merchant,
    note: row.note,
    paymentMethod: row.paymentMethod,
    participants,
    amount: row.amount,
    // 인당 분배액은 버림 기준으로 표시한다. (잔여 원은 첫 참석자에게 붙는다)
    perPersonAmount: participants.length > 0 ? Math.floor(row.amount / participants.length) : 0,
    limit,
    excess,
    status,
  };
}

/** 집계 목록 정렬 — 일자 → 사람 → 분류 순 */
function comparePersonSummary(a: PersonSummary, b: PersonSummary): number {
  return (
    a.date.localeCompare(b.date) ||
    a.person.localeCompare(b.person) ||
    a.category.localeCompare(b.category)
  );
}

/** 부분일치 비교 전에 공백을 제거한다. ("누리 파크" 같은 표기 흔들림 대응) */
function compact(value: string): string {
  return (value ?? '').replace(/\s/g, '');
}

/** 숫자 배열 합계 */
function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

/* ------------------------------------------------------------------ */
/* 형태 검증                                                           */
/* ------------------------------------------------------------------ */

/** groupBy 에 쓸 수 있는 키 */
const GROUP_KEYS: GroupKey[] = ['date', 'mealKind', 'person'];

/**
 * 규정 JSON 이 기대한 형태인지 확인한다.
 * 규정 파일을 잘못 고쳤을 때 엉뚱한 판정이 나가는 대신 즉시 오류로 알린다.
 */
export function validateRulesConfig(value: unknown): asserts value is ExpenseRulesConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('규정 파일이 객체가 아닙니다.');
  }
  const config = value as Partial<ExpenseRulesConfig>;

  requireKeywords(config.meal?.keywords, 'meal.keywords');
  requirePositive(config.meal?.perPersonPerMeal, 'meal.perPersonPerMeal');
  requireGroupBy(config.meal?.groupBy, 'meal.groupBy');

  requireKeywords(config.drink?.keywords, 'drink.keywords');
  requirePositive(config.drink?.perPersonPerDay, 'drink.perPersonPerDay');
  requireGroupBy(config.drink?.groupBy, 'drink.groupBy');

  if (!Array.isArray(config.parking?.bannedMerchants)) {
    throw new Error('규정 파일의 parking.bannedMerchants 가 배열이 아닙니다.');
  }
  if (!Array.isArray(config.parking?.bannedNoteKeywords)) {
    throw new Error('규정 파일의 parking.bannedNoteKeywords 가 배열이 아닙니다.');
  }
}

/** 키워드 배열이 비어 있지 않은지 확인한다. */
function requireKeywords(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`규정 파일의 ${path} 가 비어 있거나 배열이 아닙니다.`);
  }
}

/** 한도값이 0보다 큰 숫자인지 확인한다. */
function requirePositive(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`규정 파일의 ${path} 가 올바른 금액이 아닙니다.`);
  }
}

/** 합산 기준이 쓸 수 있는 키로만 이루어져 있는지 확인한다. */
function requireGroupBy(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`규정 파일의 ${path} 가 비어 있거나 배열이 아닙니다.`);
  }
  // 'person' 이 반드시 있어야 1인 기준 한도를 적용할 수 있다.
  if (!value.includes('person')) {
    throw new Error(`규정 파일의 ${path} 에 "person" 이 없습니다. 1인 기준 한도를 적용할 수 없습니다.`);
  }
  for (const key of value) {
    if (!GROUP_KEYS.includes(key as GroupKey)) {
      throw new Error(`규정 파일의 ${path} 에 알 수 없는 키 "${String(key)}" 가 있습니다.`);
    }
  }
}
