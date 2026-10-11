"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type Sample = { file: string; label: string; hint: string };

export type StepDef = { title: string; sub?: string };
const DEFAULT_STEPS: StepDef[] = [
  { title: "샘플 파일 업로드", sub: "샘플을 올리면 내용을 자동으로 읽어 들입니다" },
  { title: "결과 확인 및 다운로드", sub: "결과를 검토하고 파일로 저장합니다" },
];

/** A의 .stepper. current 는 0부터. steps 를 넘기면 단계 수·문구를 바꿀 수 있다. */
export function Steps({ current, steps = DEFAULT_STEPS }: { current: number; steps?: StepDef[] }) {
  return (
    <nav className="stepper" aria-label="진행 단계" style={{ "--n": steps.length } as React.CSSProperties}>
      {steps.map((s, i) => (
        <div key={s.title} className={i === current ? "step-item step-item-active" : "step-item"} aria-current={i === current ? "step" : undefined} aria-disabled={i > current}>
          <span className="step-index">{i + 1}</span>
          <span>
            <strong>{s.title}</strong>
            {s.sub ? <small>{s.sub}</small> : null}
          </span>
        </div>
      ))}
    </nav>
  );
}

const FileIcon = ({ size = 23 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" width={size} height={size} aria-hidden="true">
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 2v5h5M9 13h6M9 17h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type Shown = { name: string; hint: string };

/**
 * 진짜 드롭존(A의 .file-dropzone). 아래 "샘플 파일" 목록에서 내려받은 실제 파일을,
 * 클릭(네이티브 파일 선택창)이나 드래그로 이 박스에 올리면 onFile(file) 이 호출된다.
 * 업로드된 뒤에는 선택 파일 행(.file-selected-row)을 보여 주고 ×로 되돌린다(onClear 선택).
 */
export function SampleDropZone({ samples, onFile, onClear, accept = "xlsx / xls 형식 지원" }: {
  samples: Sample[];
  onFile: (file: File) => void;
  onClear?: () => void;
  accept?: string;
}) {
  const [picked, setPicked] = useState<Shown | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptFile = (file: File) => {
    setPicked({ name: file.name, hint: "선택한 파일" });
    onFile(file);
  };
  const clear = () => { setPicked(null); onClear?.(); };

  const cls = cn("file-dropzone", drag && "file-dropzone-active", picked && "file-dropzone-has-file");

  return (
    <div className="field-stack">
      {picked ? (
        <div className={cls}>
          <div className="file-selected-row">
            <span className="file-selected-icon" aria-hidden="true"><FileIcon /></span>
            <span className="file-selected-meta">
              <strong>{picked.name}</strong>
              <span>{picked.hint}</span>
            </span>
            <button type="button" className="file-remove-button" aria-label="선택한 파일 제거" onClick={clear}>×</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={cls}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) acceptFile(dropped);
          }}
        >
          <div className="file-empty-state">
            <span className="file-upload-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M7 16.5a4.5 4.5 0 0 1 .9-8.9A5.5 5.5 0 0 1 18.4 9.2 3.8 3.8 0 0 1 18 16.5h-2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m9 13 3-3 3 3M12 10v9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="file-empty-copy">아래 샘플 파일을 내려받아 <b>드래그하거나 클릭</b>하여 업로드해 주세요</span>
            <span className="file-format-pill"><FileIcon size={13} />{accept}</span>
          </div>
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="file-drop-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) acceptFile(f);
          e.target.value = "";
        }}
      />
      <div className="sample-download-row">
        <span className="small-muted">샘플 내려받기:</span>
        {samples.map((s) => (
          <a key={s.file} className="sample-download-link" title={s.hint} href={"/samples/" + encodeURIComponent(s.file)} download={s.file}>
            <FileIcon size={13} />{s.label}
          </a>
        ))}
      </div>
    </div>
  );
}

export type ToastState = { variant: "success" | "error" | "info" | "warning"; title: string; description?: string } | null;

/** A의 토스트(.toast-viewport / .toast-card). node 를 JSX 어딘가에 렌더링하면 된다. */
export function useToast(ms = 4000) {
  const [toast, setToast] = useState<ToastState>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast, ms]);
  const err = toast?.variant === "error";
  const node = toast
    ? createPortal(
        <div className="toast-viewport" aria-live={err ? "assertive" : "polite"}>
          <Alert className={cn("toast-card", "alert-" + toast.variant)} role={err ? "alert" : "status"}>
            <div className="toast-copy">
              <AlertTitle>{toast.title}</AlertTitle>
              {toast.description ? <AlertDescription>{toast.description}</AlertDescription> : null}
            </div>
            <button type="button" className="toast-close" aria-label="메시지 닫기" onClick={() => setToast(null)}>×</button>
          </Alert>
        </div>,
        document.body,
      )
    : null;
  return { show: setToast, clear: () => setToast(null), node };
}

/** A의 모달(.modal-backdrop > .modal-panel). 배경 클릭으로 닫힘. 클라이언트 이벤트로만 열 것. */
export function Modal({ title, description, onClose, className, children }: { title: string; description?: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={cn("modal-panel", className)} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="toast-close" aria-label="닫기" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

/** 공통 페이지 뼈대(.workflow-shell). wide 는 B(감사) 화면용 1480px. */
export function Workflow({ wide, children }: { wide?: boolean; children: React.ReactNode }) {
  return <section className={cn("workflow-shell", wide && "workflow-shell-wide")}>{children}</section>;
}
