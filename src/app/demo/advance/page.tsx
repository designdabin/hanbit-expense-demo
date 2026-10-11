"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, SampleDropZone, Steps, useToast, Workflow, type Sample, type StepDef } from "@/components/DemoShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCards } from "@/lib/advance/cards";
import type { ParsedApprovalRows } from "@/lib/advance/parser";
import { buildPreview, downloadWorkbook, matchCard, StatementError } from "@/lib/advance/service";
import type { ApprovalRow, CorporateCard, PreviewResponse } from "@/lib/advance/types";
import { CardManager } from "./CardManager";

const SAMPLES: Sample[] = [
  { file: "법인카드_승인내역_국민카드_2026년03월_오민재.xlsx", label: "카드 사용내역 샘플 (3월 · 오민재)", hint: "국민카드 · 취소 2건과 원래 결제가 자동으로 빠짐" },
];

const STEPS: StepDef[] = [
  { title: "카드 사용내역 올리기", sub: "파일을 올리면 사용한 카드를 자동으로 찾아요" },
  { title: "내역 확인 및 다운로드", sub: "취소된 결제를 빼고 정산서를 저장해요" },
];

const formatWon = (n: number) => new Intl.NumberFormat("ko-KR").format(n) + "원";

function formatMonth(month?: string) {
  const n = Number(month);
  return Number.isFinite(n) && n > 0 ? n + "월" : "확인 필요";
}

const BackIcon = () => (
  <svg className="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TitleIcon = ({ children }: { children: React.ReactNode }) => (
  <span className="icon-box" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none">{children}</svg>
  </span>
);
const UploadPath = (
  <>
    <path d="M7 16.5a4.5 4.5 0 0 1 .9-8.9A5.5 5.5 0 0 1 18.4 9.2 3.8 3.8 0 0 1 18 16.5h-2.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m9 13 3-3 3 3M12 10v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </>
);
const TablePath = (
  <>
    <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M4 10h16M9 5v14" stroke="currentColor" strokeWidth="1.8" />
  </>
);
const CancelPath = (
  <>
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="m9 9 6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </>
);

type Statement = { name: string; data: ArrayBuffer; parsed?: ParsedApprovalRows };

export default function AdvanceDemo() {
  const [cards, setCards] = useState<CorporateCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [step, setStep] = useState<0 | 1>(0);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [cardManagerOpen, setCardManagerOpen] = useState(false);
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [dropKey, setDropKey] = useState(0);
  const { show, clear, node } = useToast();

  useEffect(() => setCards(listCards()), []);

  const selectedCard = useMemo(() => cards.find((c) => c.id === selectedCardId), [cards, selectedCardId]);
  const rows = preview?.rows ?? [];
  const cancelledRows = preview?.cancelledRows ?? [];
  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const canMakePreview = Boolean(selectedCardId && statement) && !loading && !detecting;

  const clearPreview = () => { setPreview(null); setStep(0); setCancelledOpen(false); };

  const reset = () => {
    setSelectedCardId("");
    setStatement(null);
    clearPreview();
    clear();
    setLoading(false);
    setDetecting(false);
    setManualOpen(false);
    setInvalid(false);
    setDropKey((k) => k + 1);
  };

  async function detect(file: Statement, cardList: CorporateCard[], successMessage?: string) {
    setDetecting(true);
    try {
      const match = await matchCard(file.name, file.data, cardList);
      setStatement({ ...file, parsed: match.parsed });
      setInvalid(false);
      setSelectedCardId(match.card.id);
      show({ variant: "success", title: "완료", description: successMessage || match.message });
    } catch (e) {
      const isInvalid = e instanceof StatementError && e.reason === "invalid-statement";
      setInvalid(isInvalid);
      setManualOpen(!isInvalid);
      show({ variant: "error", title: "확인 필요", description: e instanceof Error ? e.message : "사용한 카드를 자동으로 찾지 못했습니다. 카드를 직접 선택해 주세요." });
    } finally {
      setDetecting(false);
    }
  }

  // 파일 바이트를 받은 뒤부터는 샘플/실제 업로드가 같은 경로를 탄다: 카드 자동 식별
  const processFile = async (name: string, data: ArrayBuffer) => {
    clearPreview();
    clear();
    setSelectedCardId("");
    setManualOpen(false);
    setInvalid(false);
    try {
      const file: Statement = { name, data };
      setStatement(file);
      await detect(file, listCards());
    } catch (e) {
      show({ variant: "error", title: "확인 필요", description: e instanceof Error ? e.message : "카드 사용내역 파일을 읽지 못했습니다." });
    }
  };

  // 샘플 파일을 내려받아 드롭존에 직접 끌어다 놓거나 선택한 실제 파일을 읽어 처리
  const pickFile = async (file: File) => {
    await processFile(file.name, await file.arrayBuffer());
  };

  const clearFile = () => {
    setStatement(null);
    setSelectedCardId("");
    setManualOpen(false);
    setInvalid(false);
    clearPreview();
    clear();
    setDetecting(false);
  };

  const selectCard = (id: string) => {
    setSelectedCardId(id);
    clearPreview();
    if (id) { clear(); setManualOpen(false); }
  };

  const makePreview = async () => {
    if (!selectedCard || !statement) {
      show({ variant: "error", title: "확인 필요", description: "카드 사용내역 파일을 올리고 사용한 카드를 확인해 주세요." });
      return;
    }
    setLoading(true);
    clear();
    try {
      const result = await buildPreview(selectedCard, statement.data, statement.parsed);
      setPreview(result);
      setStep(1);
      show({ variant: "success", title: "완료", description: result.rows.length + "건의 사용내역을 읽었습니다." + (result.cancelledRows.length ? " 취소된 결제 " + result.cancelledRows.length + "건은 별도로 분리했습니다." : "") });
    } catch (e) {
      show({ variant: "error", title: "확인 필요", description: e instanceof Error ? e.message : "미리보기를 만들지 못했습니다." });
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    if (!selectedCard || rows.length === 0) {
      show({ variant: "error", title: "확인 필요", description: "다운로드할 사용내역이 없습니다. 미리보기를 먼저 만들어 주세요." });
      return;
    }
    setLoading(true);
    clear();
    try {
      await downloadWorkbook(selectedCard, rows);
      show({ variant: "success", title: "완료", description: "경비 정산서 다운로드를 시작했습니다." });
    } catch (e) {
      show({ variant: "error", title: "확인 필요", description: e instanceof Error ? e.message : "경비 정산서를 만들지 못했습니다." });
    } finally {
      setLoading(false);
    }
  };

  const onCardsChanged = (isNew: boolean) => {
    const next = listCards();
    setCards(next);
    setSelectedCardId((cur) => next.find((c) => c.id === cur)?.id ?? "");
    if (statement && isNew) void detect(statement, next, "새로 등록한 카드로 사용내역을 다시 확인했습니다.");
  };

  const detectedTitle = detecting
    ? "카드 확인 중"
    : selectedCard
      ? selectedCard.holderName + " · " + selectedCard.cardCompany + " ****" + selectedCard.last4
      : invalid
        ? "카드 사용내역 파일이 맞는지 확인해 주세요"
        : statement
          ? "사용한 카드를 찾지 못했습니다"
          : "카드 사용내역 파일을 올려 주세요";
  const detectedCopy = selectedCard
    ? "미리보기에 사용할 카드입니다."
    : invalid
      ? "결제일, 사용처, 결제 금액이 들어 있는 카드 사용내역 파일을 올려 주세요."
      : statement
        ? "아래에서 사용한 카드를 직접 선택해 주세요."
        : "파일을 올리면 어떤 카드로 쓴 내역인지 자동으로 찾아 드립니다.";

  return (
    <Workflow>
      <Steps current={step} steps={STEPS} />

      {step === 0 ? (
        <section className="step-panel setup-grid">
          <Card>
            <CardHeader className="setup-header">
              <div className="title-row">
                <TitleIcon>{UploadPath}</TitleIcon>
                <CardTitle>카드 사용내역 올리기</CardTitle>
              </div>
              <div className="setup-header-actions">
                <CardDescription>카드사에서 받은 사용내역 엑셀을 올리면 등록된 카드와 비교해 어떤 카드로 쓴 내역인지 찾아 드립니다. 찾지 못하면 직접 선택할 수 있습니다.</CardDescription>
                <Button variant="outline" onClick={() => setCardManagerOpen(true)}>카드 관리</Button>
              </div>
            </CardHeader>
            <CardContent className="form-stack setup-form">
              <div className="field-stack setup-card-field">
                <Label>사용한 카드</Label>
                <div className={selectedCard ? "detected-card detected-card-ready" : "detected-card"}>
                  <span className="detected-card-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M3 9h18M7 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="detected-card-copy">
                    <strong>{detectedTitle}</strong>
                    <span>{detectedCopy}</span>
                  </span>
                  {statement && !detecting && !invalid ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setManualOpen((o) => !o)}>직접 선택</Button>
                  ) : null}
                </div>
                {manualOpen ? (
                  <SelectNative id="selectedCard" value={selectedCardId} onChange={(e) => selectCard(e.target.value)}>
                    <option value="">사용한 카드 선택</option>
                    {cards.map((c) => <option key={c.id} value={c.id}>{c.holderName} · {c.cardCompany} ****{c.last4}</option>)}
                  </SelectNative>
                ) : null}
              </div>
              <div className="field-stack setup-file-field">
                <Label>카드 사용내역 파일</Label>
                <SampleDropZone key={dropKey} samples={SAMPLES} onFile={pickFile} onClear={clearFile} />
              </div>
              <Button className="setup-submit" onClick={makePreview} disabled={!canMakePreview}>{loading ? "만드는 중…" : "미리보기 만들기"}</Button>
            </CardContent>
          </Card>
        </section>
      ) : (
        <section className="step-panel review-stack">
          <div className="metric-grid">
            <Card><CardContent className="metric-card"><span>사용 월</span><strong>{formatMonth(preview?.month)}</strong></CardContent></Card>
            <Card><CardContent className="metric-card"><span>사용한 카드</span><strong>{selectedCard ? selectedCard.holderName : "미확인"}</strong></CardContent></Card>
            <Card><CardContent className="metric-card"><span>포함 건수</span><strong>{rows.length}건</strong></CardContent></Card>
            <Card><CardContent className="metric-card"><span>총 금액</span><strong>{formatWon(total)}</strong></CardContent></Card>
            {cancelledRows.length > 0 ? (
              <Card>
                <CardContent className="metric-card metric-card-action">
                  <span>결제 취소 내역</span>
                  <button type="button" className="metric-text-button" onClick={() => setCancelledOpen(true)}>{cancelledRows.length}건</button>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {preview?.warnings.length ? (
            <p className="small-muted">{preview.warnings.join(" · ")}</p>
          ) : null}

          <Card>
            <CardHeader className="preview-header">
              <div>
                <div className="title-row"><TitleIcon>{TablePath}</TitleIcon><CardTitle>사용내역 확인</CardTitle></div>
                <CardDescription>정산서에 들어갈 카드 사용내역입니다.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="table-shell">
                <Table className="approval-date-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="approval-index-col">번호</TableHead>
                      <TableHead className="approval-date-col">날짜</TableHead>
                      <TableHead>사용처</TableHead>
                      <TableHead className="align-right approval-amount-col">금액</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => (
                      <TableRow key={row.id}>
                        <TableCell className="row-index mono-cell">{i + 1}</TableCell>
                        <TableCell className="nowrap mono-cell">{row.approvalDate || "-"}</TableCell>
                        <TableCell className="merchant-cell" title={row.merchant}>{row.merchant}</TableCell>
                        <TableCell className="align-right nowrap mono-cell">{formatWon(row.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="table-note">
                <span>현재 총액: {formatWon(total)}</span>
              </div>
            </CardContent>
          </Card>

          <div className="review-actions-bottom">
            <div className="review-actions-bottom-inner">
              <Button variant="outline" onClick={reset}><BackIcon />이전으로 돌아가기</Button>
              <Button onClick={download} disabled={loading || rows.length === 0}>경비 정산서 다운로드</Button>
            </div>
          </div>
        </section>
      )}

      {cardManagerOpen ? <CardManager cards={cards} onChange={onCardsChanged} onClose={() => setCardManagerOpen(false)} show={show} /> : null}

      {cancelledOpen ? (
        <Modal title="결제 취소 내역" description="취소된 결제는 정산서에 넣지 않습니다." className="cancelled-modal-panel" onClose={() => setCancelledOpen(false)}>
          <div className="table-shell cancelled-table-shell">
            <Table className="cancelled-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="cancelled-date-col">날짜</TableHead>
                  <TableHead className="cancelled-merchant-col">사용처</TableHead>
                  <TableHead className="align-right cancelled-amount-col">금액</TableHead>
                  <TableHead className="cancelled-approval-col">승인번호</TableHead>
                  <TableHead className="cancelled-status-col">상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cancelledRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="mono-cell">{row.approvalDate}</TableCell>
                    <TableCell className="cancelled-merchant-cell">{row.merchant}</TableCell>
                    <TableCell className="align-right mono-cell">{formatWon(row.amount)}</TableCell>
                    <TableCell className="mono-cell">{row.approvalNumber || "-"}</TableCell>
                    <TableCell><Badge variant="warning">{row.status || "취소"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Modal>
      ) : null}
      {node}
    </Workflow>
  );
}
