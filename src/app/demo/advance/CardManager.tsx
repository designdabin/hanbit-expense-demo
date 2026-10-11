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

  const canSave = form.holderName.trim().length > 0 && form.department !== "" && form.last4.length === 4;

  const save = () => {
    if (!canSave) return;
    try {
      saveCard({ ...form, department: form.department as CardDepartment, ...(editingId ? { id: editingId } : {}) });
      const isNew = editingId === null;
      setForm(initialForm());
      setEditingId(null);
      setError("");
      show({ variant: "success", title: "완료", description: isNew ? "카드를 등록했습니다." : "카드 정보를 수정했습니다." });
      onChange(isNew);
    } catch (e) {
      setError(e instanceof Error ? e.message : "카드를 저장하지 못했습니다.");
    }
  };

  const startEdit = (card: CorporateCard) => {
    setError("");
    setEditingId(card.id);
    setForm({ holderName: card.holderName, cardCompany: card.cardCompany, department: card.department ?? "", last4: card.last4, memo: card.memo ?? "" });
  };

  const cancelEdit = () => { setError(""); setEditingId(null); setForm(initialForm()); };

  const remove = (card: CorporateCard) => {
    if (!window.confirm(`**** ${card.last4} ${card.cardCompany}카드(${card.holderName})를 삭제하시겠습니까?\n삭제하면 되돌릴 수 없습니다.`)) return;
    deleteCard(card.id);
    if (editingId === card.id) cancelEdit();
    show({ variant: "success", title: "완료", description: "카드를 삭제했습니다." });
    onChange(false);
  };

  return (
    <Modal title="카드 관리" description="사용내역을 자동으로 찾을 때 쓸 법인카드를 등록·수정·삭제합니다." onClose={onClose}>
      {error ? (
        <Alert className="alert-error">
          <AlertTitle>카드 관리 오류</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="form-stack">
        <div className="field-stack">
          <Label htmlFor="holderName">카드 사용자 <span className="required-mark">*</span></Label>
          <Input id="holderName" value={form.holderName} onChange={(e) => setForm({ ...form, holderName: e.target.value })} placeholder="사용자 이름 (예: 홍길동)" />
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
            <Input id="memo" value={form.memo ?? ""} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="직책 또는 메모 (예: 차장)" />
          </div>
        </div>
        <div className="card-form-actions">
          {editingId ? <Button type="button" variant="outline" onClick={cancelEdit}>수정 취소</Button> : null}
          <Button onClick={save} className="full-width" disabled={!canSave}>{editingId ? "카드 수정" : "카드 등록"}</Button>
        </div>
      </div>

      <Separator />

      <div className="card-list">
        {cards.length === 0 ? (
          <div className="empty-box">등록된 카드가 없습니다. 위에서 카드를 등록해 주세요.</div>
        ) : (
          cards.map((card) => (
            <div key={card.id} className="saved-card">
              <p className="saved-card-line">
                <strong>**** {card.last4}</strong>
                <span>{card.cardCompany}카드{card.department ? " · " + card.department : ""} - {card.holderName}{card.memo ? " " + card.memo : ""}</span>
              </p>
              <div className="saved-card-actions">
                <Button type="button" variant="outline" size="sm" onClick={() => startEdit(card)}>수정</Button>
                <Button type="button" variant="outline" size="sm" className="saved-card-delete" onClick={() => remove(card)}>삭제</Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
