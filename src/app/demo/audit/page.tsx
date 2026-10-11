"use client";

/**
 * 체험 2: 경비규정 위반 적발. 전도금 데모(src/app/demo/advance)와 같은 2단계 흐름·UI 패턴을 쓴다.
 *   1단계 신청서 업로드 → 2단계 검증 결과 확인 및 다운로드
 * 업로드는 샘플 파일을 내려받아 실제로 올리는 방식 하나뿐이고, 판정은 이미 메모된 값을 쓰므로
 * "분석 시작"은 대기 없이 바로 2단계로 넘어간다.
 */

import { useEffect, useMemo, useState } from "react";
import { Modal, SampleDropZone, Steps, useToast, Workflow, type Sample } from "@/components/DemoShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import rulesConfigJson from "@/lib/audit/expenseRules.json";
import { parseEuljiFile, type EuljiFile } from "@/lib/audit/euljiParser";
import { audit, resolvePeriodMonth, validateRulesConfig, type AuditResult, type Violation } from "@/lib/audit/expenseRules";
import { limitError, limitsOf, sameLimits, withLimits, type EditableLimits } from "@/lib/audit/expenseLimits";
import { buildAuditReportBytes, buildAuditReportFileName } from "@/lib/audit/auditReport";
import { PARKING_REFERENCE_LABEL, STATUS_HINT, STATUS_LABEL } from "@/lib/audit/statusLabels";

const STEPS = [
  { title: "정산서 올리기", sub: "한 사람분 정산서를 올리면 사용 내역을 읽어 들여요" },
  { title: "점검 결과 확인 및 다운로드", sub: "규칙에 어긋난 내역을 확인하고 리포트를 저장해요" },
];

const SAMPLES: Sample[] = [
  { file: "전도금신청서_2026년04월분_홍길동.xlsx", label: "경비 정산서 샘플 (4월 · 홍길동)", hint: "식비·음료 한도 초과, 쓰면 안 되는 주차권, 인원이 안 적힌 내역이 섞인 정산서" },
];

const rawRules: unknown = rulesConfigJson;
validateRulesConfig(rawRules);
const BASE_RULES = rawRules;
const DEFAULT_LIMITS: EditableLimits = limitsOf(BASE_RULES);

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
  금지항목: "ui-badge-purple",
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
const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);
const titleIcon = (d: string) => (
  <span className="icon-box" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none"><path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </span>
);

export default function AuditDemoPage() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [entry, setEntry] = useState<{ fileName: string; parsed: EuljiFile } | null>(null);
  const [limits, setLimits] = useState<EditableLimits>(DEFAULT_LIMITS);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const { show, clear, node } = useToast();

  // 한도가 바뀌면 파싱 결과는 그대로 두고 판정만 다시 돌린다.
  const rules = useMemo(() => withLimits(BASE_RULES, limits), [limits]);
  const result = useMemo(() => (entry ? audit(entry.parsed, rules) : null), [entry, rules]);
  const usingDefaultLimits = sameLimits(limits, DEFAULT_LIMITS);

  // 파일 바이트를 받은 뒤부터는 샘플/실제 업로드가 같은 경로를 탄다: 을지 파싱
  function processFile(name: string, data: ArrayBuffer) {
    try {
      setEntry({ fileName: name, parsed: parseEuljiFile(data, name) });
    } catch (e) {
      setEntry(null);
      show({ variant: "error", title: "확인 필요", description: e instanceof Error ? e.message : "파일을 읽지 못했습니다. 샘플 파일로 다시 시도해 주세요." });
    }
  }

  // 샘플 파일을 내려받아 드롭존에 직접 끌어다 놓거나 선택한 실제 파일을 읽어 처리
  async function onFile(file: File) {
    clear();
    processFile(file.name, await file.arrayBuffer());
  }

  function analyze() {
    if (!entry) return;
    setPhase("result");
  }

  function reset() {
    setPhase("upload");
    setEntry(null);
    clear();
  }

  function download() {
    if (!result) return;
    const bytes = buildAuditReportBytes([result]);
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = buildAuditReportFileName([result]);
    a.click();
    URL.revokeObjectURL(url);
    show({ variant: "success", title: "완료", description: "리포트 엑셀 다운로드를 시작했습니다. (" + a.download + ")" });
  }

  const onResult = phase === "result" && !!entry && !!result;

  return (
    <Workflow wide={onResult}>
      <Steps current={onResult ? 1 : 0} steps={STEPS} />

      {phase === "upload" && (
        <section className="step-panel setup-grid">
          <Card>
            <CardHeader className="setup-header">
              <div className="title-row">
                {titleIcon("M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2")}
                <CardTitle>경비 정산서 올리기</CardTitle>
              </div>
              <div className="setup-header-actions">
                <CardDescription>
                  정산서를 올리면 사용 내역을 회사 경비 규칙과 비교해 식비·음료·주차비 중 규칙에 어긋난 내역을 찾아냅니다. 올린 파일은 읽기만 하고 고치지 않습니다.
                </CardDescription>
                <Button variant="outline" onClick={() => setLimitsOpen(true)}>한도 설정</Button>
              </div>
            </CardHeader>
            <CardContent className="form-stack setup-form">
              {usingDefaultLimits ? (
                <Alert className="alert-info">
                  <AlertDescription>
                    경비 정산서 파일을 올려 주세요 · 적용 한도 식비 1인 한 끼 {won(limits.mealPerPersonPerMeal)}원 / 음료 1인 하루 {won(limits.drinkPerPersonPerDay)}원
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="alert-warning">
                  <AlertTitle>회사 기본 한도와 다르게 점검합니다</AlertTitle>
                  <AlertDescription>
                    식비 {won(limits.mealPerPersonPerMeal)}원 · 음료 {won(limits.drinkPerPersonPerDay)}원으로 점검합니다. (회사 기본값은 식비 {won(DEFAULT_LIMITS.mealPerPersonPerMeal)}원 · 음료 {won(DEFAULT_LIMITS.drinkPerPersonPerDay)}원)
                  </AlertDescription>
                </Alert>
              )}

              <div className="field-stack">
                <Label>경비 정산서 파일</Label>
                <SampleDropZone samples={SAMPLES} onFile={onFile} onClear={() => { setEntry(null); clear(); }} accept="xlsx 형식, 한 사람분" />
              </div>

              <Button className="setup-submit" onClick={analyze} disabled={!entry}>점검 시작</Button>
            </CardContent>
          </Card>
        </section>
      )}

      {onResult && (
        <section className="step-panel review-stack">
          <ResultCard fileName={entry.fileName} result={result} />
          <div className="review-actions-bottom">
            <div className="review-actions-bottom-inner">
              <Button variant="outline" onClick={reset}><BackIcon />다른 정산서 올리기</Button>
              <Button onClick={download}><DownloadIcon />리포트 엑셀 다운로드</Button>
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

function ResultCard({ fileName, result }: { fileName: string; result: AuditResult }) {
  const [filter, setFilter] = useState<FilterKey>("전체");

  const rows = filter === "전체" ? result.rows : filter === "주차참고" ? result.parkingReference : result.rows.filter((r) => r.status === filter);
  const countOf = (k: FilterKey) =>
    k === "전체" ? result.rows.length : k === "주차참고" ? result.parkingReference.length : result.rows.filter((r) => r.status === k).length;

  return (
    <Card>
      <CardHeader>
        <p className="result-file-name">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 2v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span title={fileName}>{fileName}</span>
        </p>
        <div className="title-row">
          {titleIcon("m5 13 4 4L19 7")}
          <CardTitle>{result.ownerName || "(사용자 미확인)"} · {periodLabel(result)}</CardTitle>
        </div>
        <CardDescription>
          {result.totalChecked}건을 점검해 본인 부담 {result.violations.length}건, 인원 확인 필요 {result.needsReview.length}건을 찾았습니다.
        </CardDescription>
      </CardHeader>

      <CardContent className="result-sections">
        <div className="metric-grid">
          <Metric label="사용자" value={result.ownerName || "(읽지 못함)"} />
          <Metric label="사용 기간" value={periodLabel(result)} />
          <Metric label="점검 건수" value={`${result.totalChecked}건`} />
          <Metric label="식비 한도 초과" value={`${won(result.mealExcess)}원`} />
          <Metric label="음료 한도 초과" value={`${won(result.drinkExcess)}원`} />
          <Metric label="쓰면 안 되는 주차비" value={`${won(result.parkingBanned)}원`} />
          <Metric label="본인 부담 총액" value={`${won(result.totalDeduction)}원`} danger />
        </div>

        {result.needsReview.length > 0 && (
          <Alert className="alert-warning">
            <AlertTitle>인원을 읽지 못한 건 {result.needsReview.length}건</AlertTitle>
            <AlertDescription>
              사용 목적에 함께한 인원이 적혀 있지 않아 한도를 계산하지 못했습니다. 임의로 추정하지 않고 &ldquo;인원 확인 필요&rdquo;로 남겨 두었으니 원래 정산서에서 직접 확인해 주세요.
            </AlertDescription>
          </Alert>
        )}

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
            <Table>
              <TableHeader>
                <TableRow>
                  {["행", "날짜", "항목", "사용처", "사용 목적", "인원"].map((h) => <TableHead key={h}>{h}</TableHead>)}
                  {["사용 금액", "1인당 금액", "1인 한도", "초과 금액"].map((h) => <TableHead key={h} className="align-right">{h}</TableHead>)}
                  <TableHead>결과</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell className="empty-cell" colSpan={11}>조건에 맞는 내역이 없습니다.</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.rowNumber} className={`row-${r.status}`}>
                    <TableCell className="row-index mono-cell">{r.rowNumber}</TableCell>
                    <TableCell className="nowrap mono-cell">{r.date || "-"}</TableCell>
                    <TableCell className="nowrap">{r.category === "식대" ? "식비" : r.category}{r.mealKind ? `(${r.mealKind})` : ""}</TableCell>
                    <TableCell className="merchant-cell" title={r.merchant}>{r.merchant || "-"}</TableCell>
                    <TableCell className="note-cell">{r.note || "-"}</TableCell>
                    <TableCell className="align-right nowrap mono-cell" title={r.participants.length ? r.participants.join(", ") : undefined}>
                      {r.participants.length ? `${r.participants.length}명` : <span className="amount-none">-</span>}
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
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_BADGE[r.status]} title={STATUS_HINT[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <span className="small-muted">인원 수는 사용 목적에 적힌 이름을 자동으로 센 것입니다. 마우스를 올리면 읽어 낸 이름을 볼 수 있습니다.</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <Card className={danger ? "metric-card-danger" : undefined}>
      <CardContent className="metric-card">
        <span>{label}</span>
        <strong title={value}>{value}</strong>
      </CardContent>
    </Card>
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
    <Modal title="한도 설정" description="이번 점검에 쓸 식비·음료 한도를 정합니다. 저장되지는 않습니다." onClose={onClose}>
      <div className="two-col">
        <div className="field-stack">
          <Label htmlFor="meal-limit">식비 1인 한 끼 <span className="required-mark">*</span></Label>
          <Input
            id="meal-limit"
            inputMode="numeric"
            autoFocus
            value={meal}
            onChange={(e) => setMeal(e.target.value.replace(/\D/g, ""))}
            placeholder={String(DEFAULT_LIMITS.mealPerPersonPerMeal)}
            aria-invalid={!!mealError}
          />
          <span className="small-muted">같은 날 같은 끼니에 한 사람 몫으로 쓴 금액을 합쳐 이 한도와 비교합니다.</span>
        </div>
        <div className="field-stack">
          <Label htmlFor="drink-limit">음료 1인 하루 <span className="required-mark">*</span></Label>
          <Input
            id="drink-limit"
            inputMode="numeric"
            value={drink}
            onChange={(e) => setDrink(e.target.value.replace(/\D/g, ""))}
            placeholder={String(DEFAULT_LIMITS.drinkPerPersonPerDay)}
            aria-invalid={!!drinkError}
          />
          <span className="small-muted">하루 동안 한 사람 몫으로 쓴 음료값을 합쳐 이 한도와 비교합니다.</span>
        </div>
      </div>

      {(mealError || drinkError) && (
        <Alert className="alert-error"><AlertDescription>{mealError ?? drinkError}</AlertDescription></Alert>
      )}

      <Alert className="alert-info">
        <AlertDescription>
          회사 기본값은 식비 {won(DEFAULT_LIMITS.mealPerPersonPerMeal)}원 · 음료 {won(DEFAULT_LIMITS.drinkPerPersonPerDay)}원입니다. 여기서 고친 값은 이번 점검에만 쓰이고 새로고침하면 기본값으로 돌아갑니다.
        </AlertDescription>
      </Alert>

      <div className="modal-actions">
        <Button variant="outline" onClick={() => { setMeal(String(DEFAULT_LIMITS.mealPerPersonPerMeal)); setDrink(String(DEFAULT_LIMITS.drinkPerPersonPerDay)); }}>
          기본값으로 되돌리기
        </Button>
        <Button disabled={!canApply} onClick={() => onApply(next)}>적용</Button>
      </div>
    </Modal>
  );
}
