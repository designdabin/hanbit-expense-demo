"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { clauses } from "@/components/ui/clauses";
import { Tooltip } from "@/components/ui/tooltip";

export type Sample = { file: string; label: string };

/** 토스 이모지(Tossface) 래퍼. 장식용이라 스크린리더에서는 숨긴다. */
/** 표 날짜 표기: 2026-04-02 → 2026.04.02 (UX_WRITING.md 5장). 엑셀 파일 속 값은 그대로 둔다. */
export const formatDate = (d?: string) => (d ? d.replace(/-/g, ".") : "-");

export const Emoji = ({ children, size }: { children: string; size?: number }) => (
  <span className="emoji" aria-hidden="true" style={size ? { fontSize: size } : undefined}>{children}</span>
);

const FileIcon = ({ size = 23 }: { size?: number }) => <Emoji size={size}>📗</Emoji>;

type Shown = { name: string };

/**
 * 드롭존(A의 .file-dropzone). 업로드는 연출이고 처리는 진짜다: 박스를 클릭하면 800ms 뒤
 * public/samples 의 준비된 샘플(samples[0])을 "업로드"한 것으로 보고, 그 파일을 File 로 만들어 onFile(file) 에 넘긴다.
 * 파일 선택창·드래그앤드롭은 없다. 업로드된 뒤에는 선택 파일 행(.file-selected-row)을 보여 주고 ×로 되돌린다(onClear 선택).
 */
export function SampleDropZone({ samples, onFile, onClear, accept = "xlsx · xls 파일 1개" }: {
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
      setPicked({ name: sample.file });
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
            </span>
            <button type="button" className="file-remove-button" aria-label="선택한 파일 제거" onClick={clear}>×</button>
          </div>
        </div>
      ) : (
        <button type="button" className={cls} onClick={pickSample} disabled={loading} aria-busy={loading}>
          <div className="file-empty-state">
            <span className="file-upload-icon" aria-hidden="true"><Emoji>📤</Emoji></span>
            <span className="file-empty-copy">
              {loading ? "샘플 파일을 업로드하고 있어요…" : failed ? "샘플을 불러오지 못했어요. 한 번 더 눌러 주세요." : <>이 영역을 <b>누르면</b> 샘플 파일이 업로드돼요.</>}
            </span>
            {!loading && !failed ? (
              <span className="file-empty-hint">{clauses("실제 서비스에서는 내 파일을 직접 선택해 업로드해요.")}</span>
            ) : null}
            <span className="file-format-pill"><FileIcon size={13} />{accept}</span>
          </div>
        </button>
      )}
      <div className="sample-download-row">
        <span className="small-muted">샘플 내려받기:</span>
        {samples.map((s) => (
          <a key={s.file} className="sample-download-link" href={"/samples/" + encodeURIComponent(s.file)} download={s.file}>
            <FileIcon size={13} />{s.label}
          </a>
        ))}
      </div>
    </div>
  );
}

export type ToastState = { variant: "success" | "error" | "info" | "warning"; title: string; description?: string } | null;

/** 상태 아이콘(토스 이모지). 왼쪽 색 띠와 함께 쓰이고, 의미는 제목 문구가 전달한다. */
const TOAST_EMOJI = { success: "✅", error: "❌", warning: "⚠️", info: "💡" } as const;

/** 토스트 = KRDS 긴급 공지 배너 형태(.krds-toast). node 를 JSX 어딘가에 렌더링하면 된다. */
export function useToast(ms = 4000) {
  const [toast, setToast] = useState<ToastState>(null);
  const [closing, setClosing] = useState(false); // 퇴장 애니메이션 중(.krds-toast[data-state="closing"])
  const show = (t: ToastState) => { setClosing(false); setToast(t); };
  const dismiss = () => setClosing(true);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, ms);
    return () => clearTimeout(t);
  }, [toast, ms]);
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => { setToast(null); setClosing(false); }, 160); // globals.css 의 toast-out 시간과 같게
    return () => clearTimeout(t);
  }, [closing]);
  const err = toast?.variant === "error";
  const node = toast
    ? createPortal(
        <div className="toast-viewport" aria-live={err ? "assertive" : "polite"}>
          <div className={cn("krds-toast", "krds-toast-" + toast.variant)} data-state={closing ? "closing" : "open"} role={err ? "alert" : "status"}>
            <span className="krds-toast-icon" aria-hidden="true"><Emoji>{TOAST_EMOJI[toast.variant]}</Emoji></span>
            <div className="toast-copy">
              <p className="toast-title">{clauses(toast.title)}</p>
              {toast.description ? <p className="toast-desc">{clauses(toast.description)}</p> : null}
            </div>
            <button type="button" className="toast-close" aria-label="메시지 닫기" onClick={dismiss}>×</button>
          </div>
        </div>,
        document.body,
      )
    : null;
  return { show, clear: () => setToast(null), node };
}

/** A의 모달(.modal-backdrop > .modal-panel). 배경 클릭으로 닫힘. 클라이언트 이벤트로만 열 것. */
export function Modal({ title, description, onClose, className, children }: { title: string; description?: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={cn("modal-panel", className)} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{clauses(description)}</p> : null}
          </div>
          <button type="button" className="toast-close" aria-label="닫기" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

const METRIC_ICONS = {
  calendar: "📅", card: "💳", list: "📋", won: "💰", user: "🙋",
  alert: "⚠️", cancel: "🚫", meal: "🍚", cup: "☕", parking: "🅿️",
} as const;
export type MetricIcon = keyof typeof METRIC_ICONS;

/** 요약 지표 카드. tone="primary" 는 한 줄을 다 쓰는 핵심 지표, "danger" 는 빨강 강조. help 가 있으면 라벨 옆에 ? 툴팁. children 이 있으면 값 자리에 대신 렌더링. */
export function MetricCard({ icon, label, value, sub, help, tone, children }: { icon: MetricIcon; label: string; value?: string; sub?: string; help?: React.ReactNode; tone?: "primary" | "danger" | "primary-danger"; children?: React.ReactNode }) {
  const cls = cn(tone?.includes("primary") && "metric-card-primary", tone?.includes("danger") && "metric-card-danger");
  return (
    <Card className={cls || undefined}>
      <CardContent className="metric-card">
        <span className="metric-icon" aria-hidden="true"><Emoji>{METRIC_ICONS[icon]}</Emoji></span>
        <div className="metric-body">
          {help ? (
            <span className="metric-label metric-label-help">{label}<Tooltip label={`${label} 설명`}>{help}</Tooltip></span>
          ) : (
            <span className="metric-label">{label}</span>
          )}
          {sub ? (
            <div className="metric-value-row"><strong title={value}>{value}</strong><span className="metric-sub">{sub}</span></div>
          ) : (
            children ?? <strong title={value}>{value}</strong>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** 공통 페이지 뼈대(.workflow-shell). wide 는 B(감사) 화면용 1480px. */
export function Workflow({ wide, title, description, children }: { wide?: boolean; title?: string; description?: string; children: React.ReactNode }) {
  return (
    <section className={cn("workflow-shell", wide && "workflow-shell-wide")}>
      {title ? (
        <header className="page-head">
          <h1>{clauses(title)}</h1>
          {description ? <p>{clauses(description)}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
