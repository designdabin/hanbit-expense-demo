"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Sample = { file: string; label: string; hint: string };

export type StepDef = { title: string };
const DEFAULT_STEPS: StepDef[] = [
  { title: "샘플 파일 업로드" },
  { title: "결과 확인 및 다운로드" },
];

/** A의 .stepper. current 는 0부터. steps 를 넘기면 단계 수·문구를 바꿀 수 있다. */
export function Steps({ current, steps = DEFAULT_STEPS }: { current: number; steps?: StepDef[] }) {
  return (
    <nav className="stepper" aria-label="진행 단계" style={{ "--n": steps.length } as React.CSSProperties}>
      {steps.map((s, i) => (
        <div key={s.title} className={i === current ? "step-item step-item-active" : "step-item"} aria-current={i === current ? "step" : undefined} aria-disabled={i > current}>
          <span className="step-index">{i + 1}</span>
          <strong>{s.title}</strong>
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
 * 드롭존(A의 .file-dropzone). 업로드는 연출이고 처리는 진짜다: 박스를 클릭하면 800ms 뒤
 * public/samples 의 준비된 샘플(samples[0])을 "업로드"한 것으로 보고, 그 파일을 File 로 만들어 onFile(file) 에 넘긴다.
 * 파일 선택창·드래그앤드롭은 없다. 업로드된 뒤에는 선택 파일 행(.file-selected-row)을 보여 주고 ×로 되돌린다(onClear 선택).
 */
export function SampleDropZone({ samples, onFile, onClear, accept = "xlsx / xls 형식 지원" }: {
  samples: Sample[];
  onFile: (file: File) => void;
  onClear?: () => void;
  accept?: string;
}) {
  const [picked, setPicked] = useState<Shown | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const pickSample = async () => {
    const sample = samples[0];
    if (!sample || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const [res] = await Promise.all([fetch("/samples/" + encodeURIComponent(sample.file)), new Promise((r) => setTimeout(r, 800))]);
      if (!res.ok) throw new Error("sample " + res.status);
      const file = new File([await res.blob()], sample.file);
      if (!alive.current) return;
      setPicked({ name: sample.file, hint: sample.hint });
      onFile(file);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  const clear = () => { setPicked(null); onClear?.(); };

  const cls = cn("file-dropzone", picked && "file-dropzone-has-file");

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
        <button type="button" className={cls} onClick={pickSample} disabled={loading} aria-busy={loading}>
          <div className="file-empty-state">
            <span className="file-upload-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M7 16.5a4.5 4.5 0 0 1 .9-8.9A5.5 5.5 0 0 1 18.4 9.2 3.8 3.8 0 0 1 18 16.5h-2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m9 13 3-3 3 3M12 10v9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="file-empty-copy">
              {loading ? "업로드하는 중…" : failed ? "샘플을 불러오지 못했어요. 다시 클릭해 주세요" : <>이 영역을 <b>클릭</b>하면 샘플 파일이 자동으로 업로드돼요</>}
            </span>
            <span className="file-format-pill"><FileIcon size={13} />{accept}</span>
          </div>
        </button>
      )}
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

const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const METRIC_ICONS = {
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" {...S} /><path d="M4 10h16M9 3v4M15 3v4" {...S} /></>,
  card: <><rect x="3" y="6" width="18" height="13" rx="2" {...S} /><path d="M3 10h18M7 15h4" {...S} /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" {...S} />,
  won: <path d="M4 7l2.5 10L10 9l2 8 2-8 3.5 8L20 7M3 11h18M3 14h18" {...S} />,
  user: <><circle cx="12" cy="8" r="3.5" {...S} /><path d="M5 20a7 7 0 0 1 14 0" {...S} /></>,
  alert: <path d="M12 4 3 20h18L12 4Zm0 6v4m0 3h.01" {...S} />,
  cancel: <><circle cx="12" cy="12" r="8.5" {...S} /><path d="m9 9 6 6M15 9l-6 6" {...S} /></>,
  meal: <path d="M7 3v8a2 2 0 0 0 2 2v8M7 3v5M11 3v5M9 3v5M17 21V3c-2.5 1.5-3 5-3 8h3" {...S} />,
  cup: <path d="M6 5h12l-1.5 15h-9L6 5Zm1 5h10" {...S} />,
  parking: <><rect x="4" y="4" width="16" height="16" rx="3" {...S} /><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" {...S} /></>,
} as const;
export type MetricIcon = keyof typeof METRIC_ICONS;

/** 요약 지표 카드. tone="primary" 는 한 줄을 다 쓰는 핵심 지표, "danger" 는 빨강 강조. children 이 있으면 값 자리에 대신 렌더링. */
export function MetricCard({ icon, label, value, tone, children }: { icon: MetricIcon; label: string; value?: string; tone?: "primary" | "danger" | "primary-danger"; children?: React.ReactNode }) {
  const cls = cn(tone?.includes("primary") && "metric-card-primary", tone?.includes("danger") && "metric-card-danger");
  return (
    <Card className={cls || undefined}>
      <CardContent className="metric-card">
        <span className="metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none">{METRIC_ICONS[icon]}</svg></span>
        <div className="metric-body">
          <span className="metric-label">{label}</span>
          {children ?? <strong title={value}>{value}</strong>}
        </div>
      </CardContent>
    </Card>
  );
}

/** 공통 페이지 뼈대(.workflow-shell). wide 는 B(감사) 화면용 1480px. */
export function Workflow({ wide, children }: { wide?: boolean; children: React.ReactNode }) {
  return <section className={cn("workflow-shell", wide && "workflow-shell-wide")}>{children}</section>;
}
