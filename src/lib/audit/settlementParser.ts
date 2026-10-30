/**
 * src/lib/audit/settlementParser.ts
 *
 * 경비 정산서 엑셀(src/lib/settlement/form.ts 양식)에서 담당자 정보와 사용 내역을 읽어 온다.
 *
 * [읽기 전용]
 * 이 모듈은 업로드된 원본 엑셀을 절대 수정하거나 다시 저장하지 않는다.
 * XLSX.read 로 메모리에 읽기만 하며, XLSX.write / writeFile 은 사용하지 않는다.
 *
 * [열 번호를 쓰지 않는다]
 * 표의 머리글("날짜", "사용처", "금액" …)과 위쪽 요약의 라벨("담당자", "사용 기간" …)을 이름으로 찾는다.
 * 제목 위에 빈 줄이 더 있거나 열 순서가 조금 달라도 읽힌다.
 *
 * [독립 모듈 규칙]
 * Next.js / React / Node 전용 API에 의존하지 않는다.
 * 입력은 바이트 배열(ArrayBuffer)과 파일명 문자열뿐이다.
 * 양식 이름(시트·머리글·라벨)만 src/lib/settlement/form.ts 에서 가져온다.
 */

import * as XLSX from 'xlsx';
import { HEADERS, LABELS, SHEET_NAME, TOTAL_LABEL, type PaymentMethod } from '../settlement/form';

/* ------------------------------------------------------------------ */
/* 출력 타입                                                           */
/* ------------------------------------------------------------------ */

/** 사용 내역 한 줄 */
export interface SettlementRow {
  /** 엑셀 실제 행 번호 (화면에서 원본 대조용) */
  rowNumber: number;
  /** "2026-04-15" (날짜 상속 적용 후) */
  date: string;
  /** 결제금액 */
  amount: number;
  /** 결제수단 열 값으로 판정 (비어 있으면 법인카드) */
  paymentMethod: PaymentMethod;
  /** 항목(식비·주유비 등 분류). 판정에는 쓰지 않는다 */
  item: string;
  /** 사용처 */
  merchant: string;
  /** 사용 목적 원문 그대로 */
  note: string;
}

/** 경비 정산서 파일 하나의 파싱 결과 */
export interface SettlementFile {
  /** 담당자 성명 (공백 제거) */
  ownerName: string;
  /** 소속 (표시용) */
  department: string;
  /** 카드번호 원문 */
  cardNumber: string;
  /** 사용기간 원문 */
  usagePeriod: string;
  /** 개인카드 합계 — 요약에 값이 없으면 내역에서 합산한다 */
  personalCardTotal: number;
  /** 사용 내역 */
  rows: SettlementRow[];
}

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */

/**
 * 경비 정산서 엑셀을 파싱한다.
 *
 * @param buffer 엑셀 파일의 바이트 배열 (읽기만 하고 수정하지 않는다)
 * @param filename 원본 파일명. 요약에서 담당자 이름을 못 읽었을 때 여기서 뽑아 쓴다.
 */
export function parseSettlementFile(buffer: ArrayBuffer, filename: string): SettlementFile {
  // cellDates: false 로 두어 날짜를 Excel 시리얼 숫자 그대로 받는다.
  // (SSF.parse_date_code 로 직접 변환하기 위함)
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });

  const sheet = findSheet(workbook);
  if (!sheet) {
    throw new Error(`"${SHEET_NAME}" 시트를 찾을 수 없어요. 경비 정산서 양식이 맞는지 확인해 주세요.`);
  }

  const { grid, rowOffset } = readGrid(sheet);
  const header = findHeader(grid);
  if (!header) {
    throw new Error(`표에서 "${HEADERS.date}", "${HEADERS.merchant}", "${HEADERS.amount}" 머리글을 찾지 못했어요. 경비 정산서 양식이 맞는지 확인해 주세요.`);
  }

  const rows = readRows(grid, rowOffset, header);
  const summary = readSummary(grid, header.index);

  const personalFromRows = rows.filter((row) => row.paymentMethod === '개인카드').reduce((sum, row) => sum + row.amount, 0);
  const rawOwner = text(summary[LABELS.owner]);

  return {
    ownerName: rawOwner.replace(/\s/g, '') || extractNameFromFilename(filename),
    department: text(summary[LABELS.department]),
    cardNumber: text(summary[LABELS.card]),
    usagePeriod: text(summary[LABELS.period]),
    personalCardTotal: summary[LABELS.personal] === undefined ? personalFromRows : toNumber(summary[LABELS.personal]),
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* 표 읽기                                                             */
/* ------------------------------------------------------------------ */

interface Header {
  /** 머리글 줄의 배열 인덱스 */
  index: number;
  /** 머리글 이름 → 열 인덱스 */
  columns: Partial<Record<keyof typeof HEADERS, number>> & { date: number; merchant: number; amount: number };
}

/** 날짜·사용처·금액 머리글이 모두 있는 첫 줄을 찾아 열 위치를 기억한다. */
function findHeader(grid: unknown[][]): Header | null {
  for (let index = 0; index < grid.length; index += 1) {
    const row = grid[index] ?? [];
    const find = (label: string) => row.findIndex((cell) => normalize(cell) === normalize(label));
    const date = find(HEADERS.date);
    const merchant = find(HEADERS.merchant);
    const amount = find(HEADERS.amount);
    if (date < 0 || merchant < 0 || amount < 0) continue;

    const optional = (label: string) => {
      const column = find(label);
      return column < 0 ? undefined : column;
    };
    return {
      index,
      columns: { date, merchant, amount, payment: optional(HEADERS.payment), item: optional(HEADERS.item), note: optional(HEADERS.note) },
    };
  }
  return null;
}

/**
 * 머리글 아래를 읽는다. 종료는 날짜 열이 "합계"로 시작하는 첫 줄이다(없으면 시트 끝까지).
 * 빈 줄은 건너뛰고 계속 읽는다. 금액이 없는 줄은 지출 건이 아니라서 제외한다.
 */
function readRows(grid: unknown[][], rowOffset: number, header: Header): SettlementRow[] {
  const { columns } = header;
  const rows: SettlementRow[] = [];
  // 날짜가 줄마다 적혀 있지 않은 파일을 위해 직전 날짜를 기억해 두었다가 물려준다.
  let inheritedDate = '';

  for (let i = header.index + 1; i < grid.length; i += 1) {
    const row = grid[i] ?? [];
    if (normalize(row[columns.date]).startsWith(normalize(TOTAL_LABEL))) break;

    const parsedDate = toISODate(row[columns.date]);
    if (parsedDate) inheritedDate = parsedDate;

    const amount = toNumber(row[columns.amount]);
    if (amount <= 0) continue;

    rows.push({
      // 엑셀 실제 행 번호 = 시트 시작 행 + 배열 인덱스 + 1
      rowNumber: rowOffset + i + 1,
      date: inheritedDate,
      amount,
      paymentMethod: toPaymentMethod(columns.payment === undefined ? undefined : row[columns.payment]),
      item: columns.item === undefined ? '' : text(row[columns.item]),
      merchant: text(row[columns.merchant]),
      note: columns.note === undefined ? '' : text(row[columns.note]),
    });
  }

  return rows;
}

function toPaymentMethod(value: unknown): PaymentMethod {
  const compact = normalize(value);
  if (compact.includes('개인')) return '개인카드';
  if (compact.includes('현금')) return '현금';
  return '법인카드';
}

/* ------------------------------------------------------------------ */
/* 위쪽 요약 읽기                                                      */
/* ------------------------------------------------------------------ */

/** 머리글 위쪽에서 라벨을 찾아, 오른쪽 셀 값을 `라벨 → 값`으로 모은다. */
function readSummary(grid: unknown[][], headerIndex: number): Record<string, unknown> {
  const wanted = new Map(Object.values(LABELS).map((label) => [normalize(label), label]));
  const summary: Record<string, unknown> = {};

  for (let i = 0; i < headerIndex; i += 1) {
    const row = grid[i] ?? [];
    row.forEach((cell, column) => {
      const label = wanted.get(normalize(cell));
      if (!label || summary[label] !== undefined) return;
      const value = row[column + 1];
      if (value !== undefined && String(value).trim() !== '') summary[label] = value;
    });
  }
  return summary;
}

/** 파일명에서 담당자 성명을 뽑아낸다. 예) 경비정산서_2026년04월분_홍길동.xlsx → 홍길동 */
function extractNameFromFilename(filename: string): string {
  // 성명이 아닌 것이 확실한 고정 단어들
  const stopWords = ['경비', '정산서', '법인카드', '개인카드', '현금', '카드', '월분'];

  const base = filename.replace(/\.[^.]+$/, ''); // 확장자 제거
  const token = base
    .split(/[_\s\-()]+/)
    .map((part) => part.replace(/\s/g, ''))
    .find((part) => /^[가-힣]{2,4}$/.test(part) && !stopWords.includes(part));

  return token ?? '';
}

/* ------------------------------------------------------------------ */
/* 공용 헬퍼                                                           */
/* ------------------------------------------------------------------ */

/** 시트 이름을 공백 무시하고 찾는다. */
function findSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | undefined {
  const matched = workbook.SheetNames.find((sheetName) => normalize(sheetName) === normalize(SHEET_NAME));
  return matched ? workbook.Sheets[matched] : undefined;
}

/**
 * 시트를 2차원 배열로 읽는다.
 * blankrows: true 로 둬야 빈 행이 사라지지 않아 배열 인덱스와 실제 엑셀 행이 어긋나지 않는다.
 * 시트 범위가 A1 이 아닌 곳에서 시작할 수 있으므로 시작 행(rowOffset)도 함께 돌려준다.
 */
function readGrid(sheet: XLSX.WorkSheet): { grid: unknown[][]; rowOffset: number } {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: true,
    raw: true,
  });
  const rowOffset = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r : 0;

  return { grid, rowOffset };
}

/** 문자열로 정규화하고 모든 공백을 제거한다. ("합  계" → "합계") */
function normalize(value: unknown): string {
  return String(value ?? '').replace(/\s/g, '');
}

/** 셀 값을 표시용 문자열로 바꾼다. (앞뒤 공백만 정리하고 원문은 보존) */
function text(value: unknown): string {
  return String(value ?? '').trim();
}

/** 셀 값을 숫자로 바꾼다. "1,200,000원" 같은 표기도 처리한다. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === undefined || value === null) return 0;

  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Excel 날짜값을 "YYYY-MM-DD" 문자열로 변환한다.
 * 시리얼 숫자는 XLSX.SSF.parse_date_code 로, 문자열/Date 는 별도로 처리한다.
 * 날짜로 해석되지 않으면 null 을 돌려준다. (호출부에서 직전 날짜를 상속한다)
 */
function toISODate(value: unknown): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;

  // Excel 시리얼 날짜값
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed || !parsed.y) return null;
    return format(parsed.y, parsed.m, parsed.d);
  }

  // cellDates: true 로 읽은 파일이 넘어오는 경우까지 대비한다.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return format(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  // "2026-04-15", "2026.04.15", "2026/4/15" 형태의 문자열
  const match = String(value).trim().replace(/[.\s/]/g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return format(Number(match[1]), Number(match[2]), Number(match[3]));

  return null;
}

/** 연·월·일을 "YYYY-MM-DD" 로 조립한다. */
function format(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}
