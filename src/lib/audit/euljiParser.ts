/**
 * src/lib/euljiParser.ts
 *
 * 전도금 신청서 엑셀(표지 / 갑지 / 을지 / 차량운행 일지)에서
 * "을지" 시트의 지출 명세와 "갑지" 시트의 담당자 정보를 읽어 온다.
 *
 * [읽기 전용]
 * 이 모듈은 업로드된 원본 엑셀을 절대 수정하거나 다시 저장하지 않는다.
 * XLSX.read 로 메모리에 읽기만 하며, XLSX.write / writeFile 은 사용하지 않는다.
 * 따라서 원본의 수식·병합셀·서식은 그대로 보존된다.
 *
 * [독립 모듈 규칙]
 * Next.js / React / Node 전용 API에 의존하지 않는다.
 * 입력은 바이트 배열(ArrayBuffer)과 파일명 문자열뿐이므로 다른 프로젝트로 그대로 옮길 수 있다.
 */

import * as XLSX from 'xlsx';

/* ------------------------------------------------------------------ */
/* 출력 타입                                                           */
/* ------------------------------------------------------------------ */

/** 을지 시트의 지출 한 줄 */
export interface EuljiRow {
  /** 엑셀 실제 행 번호 (화면에서 원본 대조용) */
  rowNumber: number;
  /** "2026-04-15" (날짜 상속 적용 후) */
  date: string;
  /** 현장명 (B열) */
  siteName: string;
  /** 결제금액 */
  amount: number;
  /** E/F/G 중 값이 있는 열로 판정한 결제수단 */
  paymentMethod: '법인카드' | '개인카드' | '현금';
  /** 계정과목명 (H~M 중 값이 있는 열) */
  account: string;
  /** 사용처 (N열) */
  merchant: string;
  /** 사용내역 (P열) 원문 그대로 */
  note: string;
  /** 비고 (T열) */
  remark: string;
}

/** 전도금 신청서 파일 하나의 파싱 결과 */
export interface EuljiFile {
  /** 담당자 성명 (공백 제거) */
  ownerName: string;
  /** 소속 (표시용) */
  department: string;
  /** 카드번호 원문 */
  cardNumber: string;
  /** 사용기간 원문 */
  usagePeriod: string;
  /** 갑지!V25 — 개인카드 신청 합계 */
  personalCardTotal: number;
  /** 을지 지출 명세 */
  rows: EuljiRow[];
}

/* ------------------------------------------------------------------ */
/* 시트·열 상수                                                        */
/* ------------------------------------------------------------------ */

/** 우리가 읽는 시트는 을지와 갑지 두 개뿐이다. (표지 / 차량운행 일지는 읽지 않는다) */
const SHEET_EULJI = '을지';
const SHEET_GAPJI = '갑지';

/**
 * 을지 시트 열 인덱스 (0-based).
 * 병합된 열(B:D, N:O, P:S, T:U)은 병합 시작 열에만 값이 들어 있으므로 시작 열만 읽는다.
 */
const COL = {
  date: 0, // A: 일자
  siteName: 1, // B: 현장명 (B:D 병합)
  corporateCard: 4, // E: 법인카드 사용금액
  personalCard: 5, // F: 개인카드 사용금액
  cash: 6, // G: 현금 사용금액
  accountFirst: 7, // H: 계정과목 금액 시작 열
  merchant: 13, // N: 사용처 (N:O 병합)
  note: 15, // P: 사용내역 (P:S 병합)
  remark: 19, // T: 비고 (T:U 병합)
} as const;

/** H~M 열에 순서대로 대응하는 계정과목명 */
const ACCOUNT_NAMES = ['복리후생비', '주유비', '여비교통비', '물품구입비', '운송비', '기타'] as const;

/** 갑지 시트에서 담당자 정보를 읽어올 셀 주소 */
const GAPJI_CELL = {
  ownerName: 'O5', // 담당자 성명
  department: 'G5', // 소속
  cardNumber: 'G9', // 카드번호
  usagePeriod: 'G8', // 사용기간
  personalCardTotal: 'V25', // 개인카드 신청 합계 (수식 셀)
} as const;

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */

/**
 * 전도금 신청서 엑셀을 파싱한다.
 *
 * @param buffer 엑셀 파일의 바이트 배열 (읽기만 하고 수정하지 않는다)
 * @param filename 원본 파일명. 갑지에서 성명을 못 읽었을 때 여기서 뽑아 쓴다.
 */
export function parseEuljiFile(buffer: ArrayBuffer, filename: string): EuljiFile {
  // cellDates: false 로 두어 날짜를 Excel 시리얼 숫자 그대로 받는다.
  // (SSF.parse_date_code 로 직접 변환하기 위함)
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });

  const euljiSheet = findSheet(workbook, SHEET_EULJI);
  if (!euljiSheet) {
    throw new Error(`"${SHEET_EULJI}" 시트(사용 내역)를 찾을 수 없습니다. 경비 정산서 양식이 맞는지 확인해 주세요.`);
  }

  // 갑지는 없을 수도 있으므로(표지만 있는 변형 양식 등) 없으면 파일명으로 대체한다.
  const gapjiSheet = findSheet(workbook, SHEET_GAPJI);
  const owner = readGapji(gapjiSheet, filename);

  return {
    ...owner,
    rows: readEulji(euljiSheet),
  };
}

/* ------------------------------------------------------------------ */
/* 을지 시트 읽기                                                      */
/* ------------------------------------------------------------------ */

/**
 * 을지 시트에서 지출 명세를 읽는다.
 *
 * 행 번호는 절대 하드코딩하지 않는다. 양식 개정으로 헤더가 한 줄 위로 이동한 이력이 있어
 * (구 양식 8행부터 / 개정 양식 7행부터) 아래 방식으로 매번 탐지한다.
 *   - 시작 행 = A열에 "일자" 가 있는 행 + 2
 *   - 종료 행 = 시작 행 이후 A열에 "합계" 가 처음 나오는 행의 바로 앞 행
 */
function readEulji(sheet: XLSX.WorkSheet): EuljiRow[] {
  const { grid, rowOffset } = readGrid(sheet);

  // ── 시작 행 탐지 ────────────────────────────────────────────────
  // A열에서 "일자"를 찾는다. "일 자" 처럼 공백이 끼어 있을 수 있어 공백 제거 후 비교한다.
  const headerIndex = grid.findIndex((row) => normalize(pick(row, COL.date)) === '일자');
  if (headerIndex < 0) {
    throw new Error('사용 내역 시트(을지) A열에서 "일자" 제목을 찾지 못했습니다. 경비 정산서 양식이 맞는지 확인해 주세요.');
  }
  const startIndex = headerIndex + 2;

  // ── 종료 행 탐지 ────────────────────────────────────────────────
  // A열의 "합계"는 두 번 나온다. 첫 번째가 데이터 합계행이고,
  // 두 번째는 아래쪽 경비규정 블록의 합계행이므로 첫 번째만 사용한다.
  // findIndex 는 처음 만나는 것을 돌려주므로 자연히 첫 번째가 선택된다.
  const relativeTotal = grid
    .slice(startIndex)
    .findIndex((row) => normalize(pick(row, COL.date)).startsWith('합계'));

  // "합계"가 없으면 시트 끝까지 읽는다.
  const endIndex = relativeTotal < 0 ? grid.length : startIndex + relativeTotal;

  // ── 행 순회 ─────────────────────────────────────────────────────
  const rows: EuljiRow[] = [];
  // 일자는 그 날의 첫 행에만 적혀 있으므로, 직전 날짜를 기억해 두었다가 물려준다.
  let inheritedDate = '';

  for (let i = startIndex; i < endIndex; i += 1) {
    const row = grid[i] ?? [];

    // A열에 날짜가 있으면 갱신하고, 비어 있으면 직전 날짜를 그대로 상속한다.
    const parsedDate = toISODate(pick(row, COL.date));
    if (parsedDate) inheritedDate = parsedDate;

    // 결제수단(E/F/G)에서 금액을 판정한다.
    const payment = resolvePayment(row);

    // 데이터 구간 중간에 빈 행이 섞여 있다. 만나도 멈추지 말고 건너뛰고 계속 읽는다.
    // (금액이 없는 행은 실제 지출 건이 아니므로 제외한다)
    if (!payment) continue;

    rows.push({
      // 엑셀 실제 행 번호 = 시트 시작 행 + 배열 인덱스 + 1
      rowNumber: rowOffset + i + 1,
      date: inheritedDate,
      siteName: text(pick(row, COL.siteName)),
      amount: payment.amount,
      paymentMethod: payment.method,
      account: resolveAccount(row),
      merchant: text(pick(row, COL.merchant)),
      note: text(pick(row, COL.note)),
      remark: text(pick(row, COL.remark)),
    });
  }

  return rows;
}

/**
 * E(법인카드) / F(개인카드) / G(현금) 중 값이 있는 열로 결제수단과 금액을 판정한다.
 * 세 열이 모두 비어 있으면 지출 행이 아니므로 null 을 돌려준다.
 */
function resolvePayment(
  row: unknown[],
): { method: EuljiRow['paymentMethod']; amount: number } | null {
  const candidates = [
    { method: '법인카드' as const, amount: toNumber(pick(row, COL.corporateCard)) },
    { method: '개인카드' as const, amount: toNumber(pick(row, COL.personalCard)) },
    { method: '현금' as const, amount: toNumber(pick(row, COL.cash)) },
  ];

  return candidates.find((c) => c.amount > 0) ?? null;
}

/** H~M 열 중 금액이 들어 있는 열의 계정과목명을 돌려준다. 없으면 빈 문자열. */
function resolveAccount(row: unknown[]): string {
  const index = ACCOUNT_NAMES.findIndex(
    (_, offset) => toNumber(pick(row, COL.accountFirst + offset)) > 0,
  );
  return index < 0 ? '' : ACCOUNT_NAMES[index];
}

/* ------------------------------------------------------------------ */
/* 갑지 시트 읽기                                                      */
/* ------------------------------------------------------------------ */

/** 갑지에서 담당자 정보를 읽는다. 성명을 못 읽으면 파일명에서 가져온다. */
function readGapji(
  sheet: XLSX.WorkSheet | undefined,
  filename: string,
): Omit<EuljiFile, 'rows'> {
  // 성명·소속은 "박 옥 봉" 처럼 글자 사이에 공백이 들어간 경우가 있다.
  // 성명은 비교·그룹핑에 쓰이므로 공백을 제거해 정규화하고, 소속은 표시용이라 원문을 살린다.
  const rawOwnerName = sheet ? text(readCell(sheet, GAPJI_CELL.ownerName)) : '';
  const ownerName = rawOwnerName.replace(/\s/g, '') || extractNameFromFilename(filename);

  return {
    ownerName,
    department: sheet ? text(readCell(sheet, GAPJI_CELL.department)) : '',
    cardNumber: sheet ? text(readCell(sheet, GAPJI_CELL.cardNumber)) : '',
    usagePeriod: sheet ? text(readCell(sheet, GAPJI_CELL.usagePeriod)) : '',
    // V25 는 수식 셀이므로 수식(.f)이 아니라 계산된 값(.v)을 읽는다.
    personalCardTotal: sheet ? toNumber(readCell(sheet, GAPJI_CELL.personalCardTotal)) : 0,
  };
}

/** 파일명에서 담당자 성명을 뽑아낸다. 예) 전도금_신청서_04월분_홍길동_법인카드.xlsx → 홍길동 */
function extractNameFromFilename(filename: string): string {
  // 성명이 아닌 것이 확실한 고정 단어들
  const stopWords = ['전도금', '신청서', '법인카드', '개인카드', '현금', '카드', '월분'];

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

/** 시트 이름을 공백 무시하고 찾는다. (양식마다 "을 지" 처럼 띄어쓰기가 다를 수 있다) */
function findSheet(workbook: XLSX.WorkBook, name: string): XLSX.WorkSheet | undefined {
  const matched = workbook.SheetNames.find((sheetName) => normalize(sheetName) === name);
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

/**
 * 셀 주소로 값을 읽는다.
 * 병합된 셀은 값이 병합 범위의 좌측 상단 셀에만 들어 있으므로,
 * 지정한 셀이 비어 있으면 이 셀을 포함하는 병합 범위를 찾아 그 시작 셀을 읽는다.
 */
function readCell(sheet: XLSX.WorkSheet, address: string): unknown {
  const direct = sheet[address] as XLSX.CellObject | undefined;
  if (direct?.v !== undefined && String(direct.v).trim() !== '') return direct.v;

  const target = XLSX.utils.decode_cell(address);
  for (const range of sheet['!merges'] ?? []) {
    const inside =
      target.r >= range.s.r && target.r <= range.e.r &&
      target.c >= range.s.c && target.c <= range.e.c;

    if (inside) {
      const anchor = sheet[XLSX.utils.encode_cell(range.s)] as XLSX.CellObject | undefined;
      return anchor?.v;
    }
  }

  return undefined;
}

/** 열 인덱스로 셀 값을 안전하게 꺼낸다. */
function pick(row: unknown[], index: number): unknown {
  return row[index];
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
