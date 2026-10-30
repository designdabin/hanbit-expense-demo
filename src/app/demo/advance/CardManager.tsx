"use client";

import { useState } from "react";
import { Modal, type ToastState } from "@/components/DemoShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Separator } from "@/components/ui/separator";
import { deleteCard, saveCard } from "@/lib/advance/cards";
import { CARD_DEPARTMENTS, type CardDepartment, type CorporateCard } from "@/lib/advance/types";

type Form = Omit<CorporateCard, "id" | "department"> & { department: CardDepartment | "" };
const initialForm = (): Form => ({ holderName: "", cardCompany: "국민", department: "", last4: "", memo: "" });

/** 원본 카드 관리 모달: 등록/수정 폼 + 저장된 카드 목록. 변경은 이 브라우저(localStorage)에만 저장된다. */
export function CardManager({ cards, onChange, onClose, show }: {
  cards: CorporateCard[];
  /** 카드 목록이 바뀐 뒤 호출. 새 카드 등록이면 isNew=true (업로드된 파일이 있으면 다시 식별하기 위함). */
  onChange: (isNew: boolean) => void;
  onClose: () => void;
  show: (t: NonNullable<ToastState>) => void;
}) {
  const [form, setForm] = useState<Form>(initialForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CorporateCard | null>(null);

  const canSave = form.holderName.trim().length > 0 && form.department !== "" && form.last4.length === 4;

  const save = () => {
    if (!canSave) return;
    try {
      saveCard({ ...form, department: form.department as CardDepartment, ...(editingId ? { id: editingId } : {}) });
      const isNew = editingId === null;
      setForm(initialForm());
      setEditingId(null);
      setError("");
      show({ variant: "success", title: isNew ? "카드를 등록했어요" : "카드 정보를 수정했어요" });
      onChange(isNew);
    } catch (e) {
      setError(e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요.");
    }
  };

  const startEdit = (card: CorporateCard) => {
    setError("");
    setEditingId(card.id);
    setForm({ holderName: card.holderName, cardCompany: card.cardCompany, department: card.department ?? "", last4: card.last4, memo: card.memo ?? "" });
  };

  const cancelEdit = () => { setError(""); setEditingId(null); setForm(initialForm()); };

  const confirmRemove = () => {
    const card = pendingDelete;
    if (!card) return;
    setPendingDelete(null);
    deleteCard(card.id);
    if (editingId === card.id) cancelEdit();
    show({ variant: "success", title: "카드를 삭제했어요" });
    onChange(false);
  };

  return (
    <>
    <Modal title="카드 등록·관리" description="등록한 카드는 사용내역 엑셀 파일의 카드번호와 대조해 어느 카드인지 찾는 데 사용해요. 변경 내용은 이 브라우저에만 저장돼요." onClose={onClose}>
      {error ? (
        <Alert className="alert-error">
          <AlertTitle>카드를 저장하지 못했어요</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="form-stack">
        <p className="required-note"><span className="required-mark">*</span> 표시는 필수 입력 항목이에요.</p>
        <div className="field-stack">
          <Label htmlFor="holderName">카드 사용자 <span className="required-mark">*</span></Label>
          <Input id="holderName" value={form.holderName} onChange={(e) => setForm({ ...form, holderName: e.target.value })} placeholder="예: 홍길동" />
        </div>
        <div className="two-col">
          <div className="field-stack">
            <Label htmlFor="cardCompany">카드사 <span className="required-mark">*</span></Label>
            <SelectNative id="cardCompany" value={form.cardCompany} onChange={(e) => setForm({ ...form, cardCompany: e.target.value as CorporateCard["cardCompany"] })}>
              <option value="국민">국민</option>
              <option value="기업">기업</option>
            </SelectNative>
          </div>
          <div className="field-stack">
            <Label htmlFor="last4">끝 4자리 <span className="required-mark">*</span></Label>
            <Input id="last4" value={form.last4} inputMode="numeric" placeholder="예: 1234" onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
          </div>
        </div>
        <div className="two-col">
          <div className="field-stack">
            <Label htmlFor="department">소속 <span className="required-mark">*</span></Label>
            <SelectNative id="department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value as CardDepartment })}>
              <option value="">소속 선택</option>
              {CARD_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </SelectNative>
          </div>
          <div className="field-stack">
            <Label htmlFor="memo">메모</Label>
            <Input id="memo" value={form.memo ?? ""} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="예: 차장" />
          </div>
        </div>
        <div className="card-form-actions">
          {editingId ? <Button type="button" variant="outline" onClick={cancelEdit}>취소</Button> : null}
          <Button onClick={save} className="full-width" disabled={!canSave}>{editingId ? "카드 수정하기" : "카드 등록하기"}</Button>
        </div>
      </div>

      <Separator />

      <div className="card-list">
        {cards.length === 0 ? (
          <div className="empty-box">등록된 카드가 없어요. 위에서 먼저 등록해 보세요.</div>
        ) : (
          cards.map((card) => (
            <div key={card.id} className="saved-card">
              <p className="saved-card-line">
                <strong>**** {card.last4}</strong>
                <span>{card.cardCompany}카드{card.department ? " · " + card.department : ""} · {card.holderName}{card.memo ? " " + card.memo : ""}</span>
              </p>
              <div className="saved-card-actions">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(card)}>수정</Button>
                <Button type="button" variant="outline" size="sm" className="saved-card-delete" onClick={() => setPendingDelete(card)}>삭제</Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
    {pendingDelete ? (
      <Modal
        title="카드를 삭제할까요?"
        description={`${pendingDelete.cardCompany}카드 ****${pendingDelete.last4}(${pendingDelete.holderName})를 삭제하면 되돌릴 수 없어요. 이 카드의 사용내역은 자동으로 찾지 못해요.`}
        onClose={() => setPendingDelete(null)}
      >
        <div className="modal-actions">
          <Button type="button" variant="outline" autoFocus onClick={() => setPendingDelete(null)}>취소</Button>
          <Button type="button" variant="destructive" onClick={confirmRemove}>삭제</Button>
        </div>
      </Modal>
    ) : null}
    </>
  );
}
