"use client";

import { useEffect, useMemo, useState } from "react";
import { Emoji, formatDate, MetricCard, Modal, SampleDropZone, useToast, Workflow, type Sample } from "@/components/DemoShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clauses } from "@/components/ui/clauses";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCards } from "@/lib/advance/cards";
import type { ParsedApprovalRows } from "@/lib/advance/parser";
import { buildPreview, downloadWorkbook, matchCard, StatementError } from "@/lib/advance/service";
import type { ApprovalRow, CorporateCard, PreviewResponse } from "@/lib/advance/types";
import { CardManager } from "./CardManager";

const SAMPLES: Sample[] = [
  { file: "법인카드_승인내역_국민카드_2026년03월_홍길동.xlsx", label: "카드 사용내역 샘플 (3월 · 홍길동)" },
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

const TitleIcon = ({ children }: { children: string }) => (
  <span className="icon-box" aria-hidden="true"><Emoji>{children}</Emoji></span>
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
      show({ variant: "success", title: match.card.holderName + " 카드를 찾았어요", description: successMessage || match.message });
    } catch (e) {
      const isInvalid = e instanceof StatementError && e.reason === "invalid-statement";
      setInvalid(isInvalid);
      setManualOpen(!isInvalid);
      show({ variant: "error", title: isInvalid ? "파일을 확인해 주세요" : "카드를 찾지 못했어요", description: e instanceof Error ? e.message : "사용한 카드를 직접 선택해 주세요." });
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
      show({ variant: "error", title: "파일을 읽지 못했어요", description: e instanceof Error ? e.message : "카드사에서 받은 엑셀(xlsx) 파일이 맞는지 확인해 주세요." });
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
      show({ variant: "error", title: "아직 확인할 수 없어요", description: "카드 사용내역 파일을 업로드하고 사용한 카드를 확인해 주세요." });
      return;
    }
    setLoading(true);
    clear();
    try {
      const result = await buildPreview(selectedCard, statement.data, statement.parsed);
      setPreview(result);
      setStep(1);
      show({ variant: "success", title: result.rows.length + "건을 읽었어요", description: result.cancelledRows.length ? "취소된 결제 " + result.cancelledRows.length + "건은 별도로 제외했어요." : undefined });
    } catch (e) {
      show({ variant: "error", title: "사용내역을 확인하지 못했어요", description: e instanceof Error ? e.message : "파일을 확인한 뒤 다시 시도해 주세요." });
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    if (!selectedCard || rows.length === 0) {
      show({ variant: "error", title: "내려받을 내역이 없어요", description: "사용내역을 먼저 확인해 주세요." });
      return;
    }
    setLoading(true);
    clear();
    try {
      await downloadWorkbook(selectedCard, rows);
      show({ variant: "success", title: "정산서 내려받기를 시작했어요" });
    } catch (e) {
      show({ variant: "error", title: "정산서를 만들지 못했어요", description: e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요." });
    } finally {
      setLoading(false);
    }
  };

  const onCardsChanged = (isNew: boolean) => {
    const next = listCards();
    setCards(next);
    setSelectedCardId((cur) => next.find((c) => c.id === cur)?.id ?? "");
    if (statement && isNew) void detect(statement, next, "새로 등록한 카드로 사용내역을 다시 확인했어요.");
  };

  const detectedTitle = detecting
    ? "카드를 확인하고 있어요"
    : selectedCard
      ? selectedCard.holderName + " · " + selectedCard.cardCompany + " ****" + selectedCard.last4
      : invalid
        ? "카드 사용내역 파일이 맞는지 확인해 주세요"
        : statement
          ? "사용한 카드를 찾지 못했어요"
          : "파일을 업로드해 주세요";
  const detectedCopy = selectedCard
    ? "이 카드의 사용내역으로 정산서를 만들어요."
    : invalid
      ? "결제일, 사용처, 결제 금액이 들어 있는 카드 사용내역 파일을 업로드해 주세요."
      : statement
        ? "아래에서 사용한 카드를 직접 선택해 주세요."
        : "파일만 업로드하면 사용한 카드를 자동으로 찾아요.";

  return (
    <Workflow title="경비 정산서 자동 작성" description="카드사에서 받은 사용내역 엑셀 파일을 올리면, 취소된 결제는 제외하고 날짜⁠·⁠사용처⁠·⁠금액으로 정산서를 작성해요.">

      {step === 0 ? (
        <section className="step-panel setup-grid">
          <Card>
            <CardHeader className="setup-header">
              <div className="title-row">
                <TitleIcon>📤</TitleIcon>
                <CardTitle>카드 사용내역 업로드</CardTitle>
              </div>
              <div className="setup-header-actions">
                <Button variant="outline" onClick={() => setCardManagerOpen(true)}>카드 등록·관리</Button>
              </div>
            </CardHeader>
            <CardContent className="form-stack setup-form">
              <div className="field-stack setup-card-field">
                <Label>사용한 카드</Label>
                <div className={selectedCard ? "detected-card detected-card-ready" : "detected-card"}>
                  <span className="detected-card-icon" aria-hidden="true">
                    <Emoji>💳</Emoji>
                  </span>
                  <span className="detected-card-copy">
                    <strong>{detectedTitle}</strong>
                    <span>{clauses(detectedCopy)}</span>
                  </span>
                  {statement && !detecting && !invalid ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setManualOpen((o) => !o)}>직접 선택하기</Button>
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
              <Button className="setup-submit" onClick={makePreview} disabled={!canMakePreview}>{loading ? "확인하고 있어요…" : "사용내역 확인하기"}</Button>
            </CardContent>
          </Card>
        </section>
      ) : (
        <section className="step-panel review-stack">
          <Card className="result-panel">
            <CardHeader className="preview-header">
              <div className="title-row">
                <TitleIcon>📋</TitleIcon>
                <div>
                  <CardTitle>사용내역 확인</CardTitle>
                  <CardDescription>아래 <b className="data-num">{rows.length}건</b>이 정산서에 들어가요.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="result-summary">
              <div className={cancelledRows.length > 0 ? "metric-grid" : "metric-grid metric-grid-3"}>
                <MetricCard icon="calendar" label="사용 월" value={formatMonth(preview?.month)} />
                <MetricCard icon="card" label="카드 사용자" value={selectedCard ? selectedCard.holderName : "알 수 없음"} />
                <MetricCard icon="list" label="정산 건수" value={`${rows.length}건`} />
                {cancelledRows.length > 0 ? (
                  <MetricCard icon="cancel" label="결제 취소 내역">
                    <button type="button" className="metric-text-button" onClick={() => setCancelledOpen(true)} aria-label={`결제 취소 내역 ${cancelledRows.length}건 보기`}>{cancelledRows.length}건</button>
                  </MetricCard>
                ) : null}
                <MetricCard tone="primary" icon="won" label="정산 총 금액" value={formatWon(total)} />
              </div>

              {preview?.warnings.length ? (
                <p className="small-muted">{preview.warnings.join(" · ")}</p>
              ) : null}
              </div>

              <div className="result-block">
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
                        <TableCell className="nowrap mono-cell">{formatDate(row.approvalDate)}</TableCell>
                        <TableCell className="merchant-cell" title={row.merchant}>{row.merchant}</TableCell>
                        <TableCell className="align-right nowrap mono-cell">{formatWon(row.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="table-note">
                <span>정산 총 금액: {formatWon(total)}</span>
              </div>
              </div>
            </CardContent>
          </Card>

          <div className="review-actions-bottom">
            <div className="review-actions-bottom-inner">
              <Button variant="outline" onClick={reset}><BackIcon />다른 파일 업로드</Button>
              <Button onClick={download} disabled={loading || rows.length === 0}>정산서 내려받기</Button>
            </div>
          </div>
        </section>
      )}

      {cardManagerOpen ? <CardManager cards={cards} onChange={onCardsChanged} onClose={() => setCardManagerOpen(false)} show={show} /> : null}

      {cancelledOpen ? (
        <Modal title="결제 취소 내역" description={`취소된 결제 ${cancelledRows.length}건은 정산서에서 제외했어요.`} className="cancelled-modal-panel" onClose={() => setCancelledOpen(false)}>
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
                    <TableCell className="mono-cell">{formatDate(row.approvalDate)}</TableCell>
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
