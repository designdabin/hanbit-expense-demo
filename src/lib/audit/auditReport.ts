/**
 * src/lib/auditReport.ts
 *
 * 판정 결과(AuditResult)를 검증 리포트 엑셀로 만든다.
 *
 * [절대 원칙 — 원본은 건드리지 않는다]
 * 업로드된 원본 파일을 열지도, 수정하지도, 다시 저장하지도 않는다.
 * 여기서는 XLSX.utils.book_new() 로 **완전히 새 워크북**을 처음부터 만들어 내려준다.
 * 원본에서 온 것은 이미 메모리에 읽어 둔 판정 결과 값뿐이고, 원본 파일 자체는 손대지 않는다.
 *
 * [시트 3개]
 *   ① 위반내역 — 행 단위
 *   ② 인별집계 — 사람·일자 단위
 *   ③ 정산요약 — 담당자별 1행
 *
 * 담당자를 여러 명 한 번에 분석할 수 있으므로 모든 시트에 담당자 열이 들어간다.
 *
 * [독립 모듈 규칙]
 * 파일을 직접 저장하지 않는다. 바이트 배열까지만 만들고, 저장·전송은 호출하는 쪽이 한다.
 * (서버에서는 HTTP 응답 본문으로, 브라우저에서는 Blob 으로 쓴다)
 */

import * as XLSX from 'xlsx';
import { resolvePeriodMonth, type AuditResult, type Violation } from './expenseRules';
import { PARKING_REFERENCE_LABEL, STATUS_LABEL } from './statusLabels';

/* ------------------------------------------------------------------ */
/* 시트 ① 위반내역                                                     */
/* ------------------------------------------------------------------ */

/**
 * 리포트에 담을 행을 고른다.
 *
 * 정상 행까지 전부 넣으면 "위반내역" 이라는 이름이 무색해지므로,
 * 조치가 필요한 행만 담는다: 한도초과 · 금지항목 · 확인필요,
 * 그리고 위반은 아니지만 눈으로 봐야 하는 주차 참고내역.
 */
function pickReportRows(result: AuditResult): Violation[] {
  return result.rows
    .filter(
      (row) =>
        row.status !== '정상' ||
        // 주차 참고내역 — 판정은 정상이지만 확인 대상이라 함께 싣는다.
        (row.category === '주차비' && row.status === '정상'),
    )
    .sort((a, b) => a.rowNumber - b.rowNumber);
}

/**
 * 판정 열에 적을 말을 고른다.
 *
 * 화면과 같은 표(src/lib/statusLabels.ts)를 써야 담당자가 두 곳에서 같은 말을 본다.
 * 주차 참고내역만 예외인데, 판정값은 '정상'이지만 화면에서 따로 묶어 보여 주는
 * 목록이라 엑셀에서도 그 이름으로 적는다.
 */
function statusLabelOf(row: Violation): string {
  if (row.status === '정상' && row.category === '주차비') return PARKING_REFERENCE_LABEL;
  return STATUS_LABEL[row.status];
}

/** ① 위반내역 시트 — 행 단위 */
function buildViolationSheet(results: AuditResult[]): XLSX.WorkSheet {
  const rows = results.flatMap((result) =>
    pickReportRows(result).map((row) => ({
      담당자: result.ownerName,
      행번호: row.rowNumber,
      일자: row.date,
      // 식대는 끼니까지 보여야 어느 한도가 걸렸는지 알 수 있다.
      구분: row.mealKind ? `${row.category}(${row.mealKind})` : row.category,
      결제수단: row.paymentMethod,
      사용처: row.merchant,
      사용내역: row.note,
      // 누가 먹었는지가 아니라 몇 명이 썼는지를 본다. 판정 대상이 아닌 행은 비워 둔다.
      '인원(명)': row.participants.length > 0 ? row.participants.length : '',
      '사용금액(원)': row.amount,
      '인당 분배액(원)': row.perPersonAmount,
      '한도(원)': row.limit,
      '초과금액(원)': row.excess,
      판정: statusLabelOf(row),
    })),
  );

  const sheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['조치가 필요한 건이 없습니다.']]);

  sheet['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 20 },
    { wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 10 },
  ];

  return sheet;
}

/* ------------------------------------------------------------------ */
/* 시트 ② 인별집계                                                     */
/* ------------------------------------------------------------------ */

/** ② 인별집계 시트 — 사람·일자 단위 (한도 이내인 그룹도 함께 싣는다) */
function buildPersonSheet(results: AuditResult[]): XLSX.WorkSheet {
  const rows = results.flatMap((result) =>
    result.byPerson.map((entry) => ({
      담당자: result.ownerName,
      참석자: entry.person,
      일자: entry.date,
      구분: entry.category,
      '합산금액(원)': entry.total,
      '한도(원)': entry.limit,
      '초과금액(원)': entry.excess,
    })),
  );

  const sheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['집계할 건이 없습니다.']]);

  sheet['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
  ];

  return sheet;
}

/* ------------------------------------------------------------------ */
/* 시트 ③ 정산요약                                                     */
/* ------------------------------------------------------------------ */

/** ③ 정산요약 시트 — 담당자별 1행 */
function buildSummarySheet(results: AuditResult[]): XLSX.WorkSheet {
  const rows = results.map((result) => ({
    담당자: result.ownerName,
    사용기간: result.usagePeriod,
    // 열 이름은 화면 요약 지표와 같은 말을 쓴다.
    '식대 초과분(원)': result.mealExcess,
    '음료 초과분(원)': result.drinkExcess,
    '전액 차감 주차비(원)': result.parkingBanned,
    '차감 대상 총액(원)': result.totalDeduction,
    '개인카드 합계(원)': result.personalCardTotal,
    // 개인카드 합계에서 차감 대상 금액을 상계한 실제 지급액
    '상계 후 정산액(원)': result.personalCardTotal - result.totalDeduction,
  }));

  const sheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['정산할 건이 없습니다.']]);

  sheet['!cols'] = [
    { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 14 },
    { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
  ];

  return sheet;
}

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */

/**
 * 판정 결과로 새 워크북을 만든다. (원본 파일은 열지 않는다)
 *
 * @param results 담당자(파일)별 판정 결과. 여러 명을 한 번에 넣을 수 있다.
 */
export function buildAuditReportWorkbook(results: AuditResult[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, buildViolationSheet(results), '위반내역');
  XLSX.utils.book_append_sheet(workbook, buildPersonSheet(results), '인별집계');
  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(results), '정산요약');

  return workbook;
}

/**
 * 리포트를 .xlsx 바이트 배열로 직렬화한다.
 *
 * 내용은 buildAuditReportWorkbook 이 만든 시트 그대로이고, 파일로 내릴 때 표 서식을 입힌다:
 * 모든 칸에 테두리, 머리글 줄은 굵은 글씨에 회색 배경·왼쪽 정렬, 숫자는 오른쪽 정렬에 천 단위 쉼표.
 * (xlsx 라이브러리는 서식을 쓰지 못해 exceljs 로 옮겨 쓴다. 무거운 라이브러리라 내려받을 때 불러온다)
 * 반환 타입을 Uint8Array<ArrayBuffer> 로 못박아야 브라우저에서 Blob 에 그대로 넣을 수 있다.
 */
export async function buildAuditReportBytes(results: AuditResult[]): Promise<Uint8Array<ArrayBuffer>> {
  const source = buildAuditReportWorkbook(results);
  const ExcelJSModule = await import('exceljs');
  const workbook = new (ExcelJSModule.default ?? ExcelJSModule).Workbook();

  const line = { style: 'thin' as const, color: { argb: 'FF6B7280' } };
  const box = { top: line, bottom: line, left: line, right: line };
  const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD1D5DB' } };

  for (const name of source.SheetNames) {
    const sheet = source.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
    const target = workbook.addWorksheet(name);
    (sheet['!cols'] ?? []).forEach((col, index) => {
      target.getColumn(index + 1).width = col.wch ?? 12;
    });

    // 머리글 아래에 줄이 없으면 "건이 없습니다" 안내 한 줄이라 서식 없이 그대로 둔다.
    const isTable = aoa.length > 1;
    aoa.forEach((values, rowIndex) => {
      const row = target.addRow(values);
      if (!isTable) return;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = box;
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        if (rowIndex === 0) {
          cell.font = { bold: true };
          cell.fill = headerFill;
        } else if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        }
      });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/**
 * 다운로드 파일명을 만든다.
 *
 *   경비규정준수확인_04월분_홍길동.xlsx      담당자 한 명
 *   경비규정준수확인_04월분_전체.xlsx        여러 담당자를 한 번에 분석한 경우
 *
 * 월을 알아내지 못하면 "N월분" 을 빼고 만든다.
 */
export function buildAuditReportFileName(results: AuditResult[]): string {
  const month = extractMonth(results);

  // 담당자가 한 명일 때만 이름을 쓰고, 여러 명이면 "전체" 로 묶는다.
  const owners = [...new Set(results.map((result) => result.ownerName).filter(Boolean))];
  const owner = owners.length === 1 ? owners[0] : owners.length === 0 ? '담당자미상' : '전체';

  return ['경비규정준수확인', month ? `${month}월분` : '', owner].filter(Boolean).join('_') + '.xlsx';
}

/* ------------------------------------------------------------------ */
/* 내부 헬퍼                                                           */
/* ------------------------------------------------------------------ */

/**
 * 파일명에 쓸 월(두 자리)을 알아낸다.
 * 월을 집어내는 규칙은 화면과 같아야 하므로 src/lib/expenseRules.ts 의 함수를 그대로 쓴다.
 *
 * 여러 달을 한 번에 묶으면 "03-04" 처럼 모두 적는다.
 * 첫 달만 쓰면 03월분 파일 안에 04월 내역이 숨어 버린다.
 */
function extractMonth(results: AuditResult[]): string {
  const months = results.map((result) => resolvePeriodMonth(result)?.month ?? '').filter(Boolean);

  // 등장 순서를 유지하면서 중복만 제거한다.
  return [...new Set(months)].join('-');
}
