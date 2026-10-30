"use client";

/**
 * 체험 2: 경비 규정 준수 확인. 정산서 자동 작성 데모(src/app/demo/advance)와 같은 2단계 흐름·UI 패턴을 쓴다.
 *   1단계 정산서 업로드 → 2단계 검증 결과 확인 및 다운로드
 * 업로드는 샘플 파일을 내려받아 실제로 올리는 방식 하나뿐이고, 판정은 이미 메모된 값을 쓰므로
 * "분석 시작"은 대기 없이 바로 2단계로 넘어간다.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Emoji, formatDate, MetricCard, Modal, SampleDropZone, useToast, Workflow, type Sample } from "@/components/DemoShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clauses } from "@/components/ui/clauses";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import rulesConfigJson from "@/lib/audit/expenseRules.json";
import { parseSettlementFile, type SettlementFile } from "@/lib/audit/settlementParser";
import { audit, resolvePeriodMonth, validateRulesConfig, type AuditResult, type Violation } from "@/lib/audit/expenseRules";
import { limitError, limitsOf, sameLimits, withLimits, type EditableLimits } from "@/lib/audit/expenseLimits";
import { buildAuditReportBytes, buildAuditReportFileName } from "@/lib/audit/auditReport";
import { PARKING_REFERENCE_LABEL, STATUS_HINT, STATUS_LABEL } from "@/lib/audit/statusLabels";

const SAMPLES: Sample[] = [
  { file: "경비정산서_2026년04월분_홍길동.xlsx", label: "경비 정산서 샘플 (4월 · 홍길동)" },
];

const rawRules: unknown = rulesConfigJson;
validateRulesConfig(rawRules);
const BASE_RULES = rawRules;
const DEFAULT_LIMITS: EditableLimits = limitsOf(BASE_RULES);

/** 표 헤더 옆 정보(?) 툴팁 문구 */
// 금지 주차장 이름은 규정 파일(expenseRules.json)의 값을 그대로 쓴다
const PARKING_HELP = `회사가 지정한 금지 주차장(예: ${BASE_RULES.parking.bannedMerchants.join("·")})에서 주차권을 구매한 결제예요. 한도와 관계없이 결제 금액 전체를 본인이 부담해요.`;

const HEAD_HELP: Record<string, ReactNode> = {
  "번호": "올린 정산서(엑셀)에서 해당 내역이 있는 행 번호예요.",
  "인원": "'-'나 ':' 뒤의 이름을 쉼표로 나눠 세어요. '중식 4명'처럼 기호 없이 적으면 읽지 못해 '인원 확인 필요'로 표시해요.",
  "1인당 금액": "사용 금액 ÷ 인원",
  "초과 금액": <>(1인당 금액 − 1인 한도) × 인원<br />결제 금지 항목은 사용 금액 전체예요.</>,
};
const headLabel = (h: string) =>
  HEAD_HELP[h] ? <span className="th-help">{h}<Tooltip label={`${h} 설명`}>{HEAD_HELP[h]}</Tooltip></span> : h;

const FILTERS = [
  { key: "전체", label: "전체" },
  { key: "한도초과", label: STATUS_LABEL.한도초과 },
  { key: "금지항목", label: STATUS_LABEL.금지항목 },
  { key: "확인필요", label: STATUS_LABEL.확인필요 },
  { key: "주차참고", label: PARKING_REFERENCE_LABEL },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

/** 판정별 배지 색 (globals.css 의 ui-badge 변형) */
const STATUS_BADGE: Record<Violation["status"], string> = {
  정상: "ui-badge-secondary",
  한도초과: "ui-badge-danger",
  금지항목: "ui-badge-danger-strong",
  확인필요: "ui-badge-warning",
};

const won = (n: number) => n.toLocaleString("ko-KR");

function periodLabel(r: AuditResult) {
  const p = resolvePeriodMonth(r);
  return p ? `${p.year}년 ${Number(p.month)}월` : "-";
}

type Phase = "upload" | "result";

const Icon = ({ d, children }: { d?: string; children?: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="button-icon">
    {d ? <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : children}
  </svg>
);
const BackIcon = () => <Icon d="M15 18l-6-6 6-6" />;
const titleIcon = (emoji: string) => (
  <span className="icon-box" aria-hidden="true"><Emoji>{emoji}</Emoji></span>
);

export default function AuditDemoPage() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [entry, setEntry] = useState<{ fileName: string; parsed: SettlementFile } | null>(null);
  const [limits, setLimits] = useState<EditableLimits>(DEFAULT_LIMITS);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const { show, clear, node } = useToast();

  // 한도가 바뀌면 파싱 결과는 그대로 두고 판정만 다시 돌린다.
  const rules = useMemo(() => withLimits(BASE_RULES, limits), [limits]);
  const result = useMemo(() => (entry ? audit(entry.parsed, rules) : null), [entry, rules]);
  const usingDefaultLimits = sameLimits(limits, DEFAULT_LIMITS);

  // 파일 바이트를 받은 뒤부터는 샘플/실제 업로드가 같은 경로를 탄다: 정산서 파싱
  function processFile(name: string, data: ArrayBuffer) {
    try {
      const parsed = parseSettlementFile(data, name);
      setEntry({ fileName: name, parsed });
      // 확인 범위를 확인 전에 알린다: 규정 판정 대상은 식비·음료·주차비뿐이고 그 밖의 지출('기타')은 비교하지 않는다
      const { rows } = audit(parsed, rules);
      show({ variant: "success", title: "정산서를 읽었어요", description: `전체 ${rows.length}건 중 식비·음료·주차비 ${rows.filter((r) => r.category !== "기타").length}건을 확인해요.` });
    } catch (e) {
      setEntry(null);
      show({ variant: "error", title: "파일을 읽지 못했어요", description: e instanceof Error ? e.message : "샘플 파일로 다시 시도해 주세요." });
    }
  }

  // 샘플 파일을 내려받아 드롭존에 직접 끌어다 놓거나 선택한 실제 파일을 읽어 처리
  async function onFile(file: File) {
    clear();
    processFile(file.name, await file.arrayBuffer());
  }

  function analyze() {
    if (!entry) return;
    clear();
    setPhase("result");
  }

  function reset() {
    setPhase("upload");
    setEntry(null);
    clear();
  }

  async function download() {
    if (!result) return;
    const bytes = await buildAuditReportBytes([result]);
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = buildAuditReportFileName([result]);
    a.click();
    URL.revokeObjectURL(url);
    show({ variant: "success", title: "리포트 내려받기를 시작했어요", description: a.download });
  }

  const onResult = phase === "result" && !!entry && !!result;

  return (
    <Workflow title="경비 규정 준수 확인" description="완성된 경비 정산서(엑셀)를 올리면 식비⁠·⁠음료가 한도를 지켰는지, 결제가 금지된 주차비는 없는지 한 번에 확인해요. 규정에 어긋난 내역은 한눈에 알아볼 수 있게 표시해요.">

      {phase === "upload" && (
        <section className="step-panel setup-grid">
          <Card>
            <CardHeader className="setup-header">
              <div className="title-row">
                {titleIcon("📤")}
                <CardTitle>경비 정산서 업로드</CardTitle>
              </div>
              <div className="setup-header-actions">
                <Button variant="outline" onClick={() => setLimitsOpen(true)}>한도 설정하기</Button>
              </div>
            </CardHeader>
            <CardContent className="form-stack setup-form">
              {usingDefaultLimits ? (
                <Alert className="alert-info">
                  <AlertDescription>
                    식비 한 끼 1인 {won(limits.mealPerPersonPerMeal)}원, 음료 하루 1인 {won(limits.drinkPerPersonPerDay)}원 기준으로 확인해요.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="alert-warning">
                  <AlertTitle>회사 기본 한도와 다르게 확인해요</AlertTitle>
                  <AlertDescription>
                    식비 {won(limits.mealPerPersonPerMeal)}원 · 음료 {won(limits.drinkPerPersonPerDay)}원으로 확인해요. (회사 기본값은 식비 {won(DEFAULT_LIMITS.mealPerPersonPerMeal)}원 · 음료 {won(DEFAULT_LIMITS.drinkPerPersonPerDay)}원)
                  </AlertDescription>
                </Alert>
              )}

              <div className="field-stack setup-file-field">
                <Label>경비 정산서 파일</Label>
                <SampleDropZone samples={SAMPLES} onFile={onFile} onClear={() => { setEntry(null); clear(); }} accept="xlsx · 정산서 1개" />
              </div>

              <Button className="setup-submit" onClick={analyze} disabled={!entry}>확인하기</Button>
            </CardContent>
          </Card>
        </section>
      )}

      {onResult && (
        <section className="step-panel review-stack">
          <ResultCard result={result} />
          <div className="review-actions-bottom">
            <div className="review-actions-bottom-inner">
              <Button variant="outline" onClick={reset}><BackIcon />다른 정산서 업로드</Button>
              <Button onClick={download}>리포트 내려받기</Button>
            </div>
          </div>
        </section>
      )}

      {limitsOpen && (
        <LimitsModal
          limits={limits}
          onApply={(next) => { setLimits(next); setLimitsOpen(false); }}
          onClose={() => setLimitsOpen(false)}
        />
      )}
      {node}
    </Workflow>
  );
}

function ResultCard({ result }: { result: AuditResult }) {
  const [filter, setFilter] = useState<FilterKey>("전체");

  // 식비·음료·주차비만 표에 보인다. 주유비 같은 비교 대상 밖 내역(기타)은 건수에만 포함된다.
  const comparedRows = result.rows.filter((r) => r.category !== "기타");
  const compared = comparedRows.length;
  const rows = filter === "전체" ? comparedRows : filter === "주차참고" ? result.parkingReference : comparedRows.filter((r) => r.status === filter);
  const countOf = (k: FilterKey) =>
    k === "전체" ? compared : k === "주차참고" ? result.parkingReference.length : comparedRows.filter((r) => r.status === k).length;

  const overCount = (category: string, status: string) => comparedRows.filter((r) => r.category === category && r.status === status).length;

  return (
    <>
      <Card className="result-panel">
        <CardHeader className="preview-header">
          <div className="title-row">
            {titleIcon("📋")}
            <div>
              <CardTitle>확인 결과</CardTitle>
              <CardDescription>
                전체 <b className="data-num">{result.totalChecked}건</b> 중 식비·음료·주차비 <b className="data-num">{compared}건</b>을 규정과 비교했어요. 본인 부담은 <b className="data-num data-num-danger">{result.violations.length}건</b>, 인원 확인이 필요한 내역은 <b className="data-num data-num-warning">{result.needsReview.length}건</b>이에요.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="result-summary">
          <div className="metric-grid metric-grid-3">
            <MetricCard icon="user" label="카드 사용자" value={result.ownerName || "이름 없음"} />
            <MetricCard icon="calendar" label="사용 기간" value={periodLabel(result)} />
            <MetricCard icon="list" label="규정 확인 내역" value={`${compared}건`} sub={`전체 ${result.totalChecked}건 중`} />
            <MetricCard icon="meal" label="식비 한도 초과" value={`${won(result.mealExcess)}원`} sub={`${overCount("식대", "한도초과")}건`} />
            <MetricCard icon="cup" label="음료 한도 초과" value={`${won(result.drinkExcess)}원`} sub={`${overCount("음료", "한도초과")}건`} />
            <MetricCard icon="parking" label="결제 금지 주차비" help={PARKING_HELP} value={`${won(result.parkingBanned)}원`} sub={`${overCount("주차비", "금지항목")}건`} />
            <MetricCard tone="primary-danger" icon="alert" label="본인 부담 총액" value={`${won(result.totalDeduction)}원`} />
          </div>

          {result.needsReview.length > 0 && (
            <Alert className="alert-warning">
              <AlertTitle>인원을 확인하지 못한 내역이 {result.needsReview.length}건 있어요</AlertTitle>
              <AlertDescription>
                사용 목적에서 인원을 읽지 못해서 한도를 계산하지 못했어요. 원본 정산서에 '-' 뒤에 이름이나 인원을 적었는지 확인해 주세요.
              </AlertDescription>
            </Alert>
          )}
          </div>

          <div className="result-block">
            <div className="tab-bar">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={filter === key ? "tab-button tab-button-active" : "tab-button"}
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                >
                  {label}
                  <span className="tab-count">{countOf(key)}</span>
                </button>
              ))}
            </div>

            <div className="table-shell">
              <Table className="audit-table">
                <TableHeader>
                  <TableRow>
                    {["번호", "날짜", "항목", "사용처", "사용 목적", "인원"].map((h) => <TableHead key={h}>{headLabel(h)}</TableHead>)}
                    <TableHead>결과</TableHead>
                    {["사용 금액", "1인당 금액", "1인 한도", "초과 금액"].map((h) => <TableHead key={h} className="align-right">{headLabel(h)}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell className="empty-cell" colSpan={11}>조건에 맞는 내역이 없어요.</TableCell></TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow key={r.rowNumber} className={`row-${r.status}`}>
                      <TableCell className="row-index mono-cell">{r.rowNumber}</TableCell>
                      <TableCell className="nowrap mono-cell">{formatDate(r.date)}</TableCell>
                      <TableCell className="nowrap">{r.category === "식대" ? "식비" : r.category}{r.mealKind ? `(${r.mealKind})` : ""}</TableCell>
                      <TableCell className="merchant-cell" title={r.merchant}>{r.merchant || "-"}</TableCell>
                      <TableCell className="note-cell">{r.note || "-"}</TableCell>
                      <TableCell className="align-right nowrap mono-cell" title={r.participants.length ? r.participants.join(", ") : undefined}>
                        {r.participants.length ? `${r.participants.length}명` : <span className="amount-none">-</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={STATUS_BADGE[r.status]} title={STATUS_HINT[r.status]}>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-right nowrap mono-cell">{won(r.amount)}</TableCell>
                      <TableCell className="align-right nowrap mono-cell">
                        {r.perPersonAmount > 0 ? won(r.perPersonAmount) : <span className="amount-none">-</span>}
                      </TableCell>
                      <TableCell className="align-right nowrap mono-cell">
                        {r.limit > 0 ? won(r.limit) : <span className="amount-none">-</span>}
                      </TableCell>
                      <TableCell className="align-right nowrap mono-cell">
                        {r.excess > 0 ? <span className="amount-over">{won(r.excess)}</span> : <span className="amount-none">-</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

/** 식대·음료 한도를 고쳐 결과가 즉시 다시 판정되는 것을 체험하는 모달. 적용을 눌러야 반영된다. */
function LimitsModal({ limits, onApply, onClose }: { limits: EditableLimits; onApply: (l: EditableLimits) => void; onClose: () => void }) {
  const [meal, setMeal] = useState(String(limits.mealPerPersonPerMeal));
  const [drink, setDrink] = useState(String(limits.drinkPerPersonPerDay));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const next: EditableLimits = { mealPerPersonPerMeal: Number(meal), drinkPerPersonPerDay: Number(drink) };
  const mealError = meal.trim() === "" ? null : limitError(next.mealPerPersonPerMeal, "식비");
  const drinkError = drink.trim() === "" ? null : limitError(next.drinkPerPersonPerDay, "음료");
  const canApply = meal.trim() !== "" && drink.trim() !== "" && !mealError && !drinkError;

  return (
    <Modal title="한도 설정" description="바꾼 한도는 이번 확인에만 적용되고, 새로고침하면 회사 기본값으로 돌아가요." onClose={onClose}>
      <p className="required-note limit-required"><span className="required-mark">*</span> 표시는 필수 입력 항목이에요.</p>
      <div className="two-col">
        <div className="field-stack limit-field">
          <Label htmlFor="meal-limit">식비 1인 한 끼 (원) <span className="required-mark">*</span></Label>
          <Input
            id="meal-limit"
            inputMode="numeric"
            autoFocus
            value={meal}
            onChange={(e) => setMeal(e.target.value.replace(/\D/g, ""))}
            placeholder={String(DEFAULT_LIMITS.mealPerPersonPerMeal)}
            aria-invalid={!!mealError}
          />
          <span className="small-muted">{clauses("식비는 한 끼 기준이에요.")}</span>
        </div>
        <div className="field-stack limit-field">
          <Label htmlFor="drink-limit">음료 1인 하루 (원) <span className="required-mark">*</span></Label>
          <Input
            id="drink-limit"
            inputMode="numeric"
            value={drink}
            onChange={(e) => setDrink(e.target.value.replace(/\D/g, ""))}
            placeholder={String(DEFAULT_LIMITS.drinkPerPersonPerDay)}
            aria-invalid={!!drinkError}
          />
          <span className="small-muted">{clauses("음료는 하루 기준이에요.")}</span>
        </div>
      </div>
      <div className="limit-note">
        <span>1인당 금액 = 사용 금액 ÷ 인원</span>
        <span>초과 금액 = (1인당 금액 − 1인 한도) × 인원</span>
      </div>

      {(mealError || drinkError) && (
        <Alert className="alert-error"><AlertDescription>{mealError ?? drinkError}</AlertDescription></Alert>
      )}

      <div className="modal-actions">
        <Button variant="outline" onClick={() => { setMeal(String(DEFAULT_LIMITS.mealPerPersonPerMeal)); setDrink(String(DEFAULT_LIMITS.drinkPerPersonPerDay)); }}>
          기본값으로 되돌리기
        </Button>
        <Button disabled={!canApply} onClick={() => onApply(next)}>한도 적용하기</Button>
      </div>
    </Modal>
  );
}
