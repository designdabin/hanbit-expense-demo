"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * KRDS 툴팁(정보 아이콘형): 활성화 버튼(.krds-tooltip) + 팝오버(.krds-tooltip-popover).
 * 표시: 마우스 오버 / 키보드 포커스 / 터치 탭. 숨김: 버튼·팝오버 밖으로 나감 / 바깥 누름 / Esc(포커스는 버튼으로).
 * 짧은 설명(150자 안팎)용이다. 같은 요소에 title 속성과 함께 쓰지 않는다.
 * 팝오버는 body 포털로 그려 overflow:auto 인 표 안에서도 잘리지 않고, 화면 밖이면 아래·안쪽으로 접어 넣는다.
 */
export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const suppressed = React.useRef(false); // Esc 로 닫힌 뒤 다시 들어오기 전까지 숨김 유지
  const pointerType = React.useRef("mouse");
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  const show = () => { clearTimeout(closeTimer.current); setOpen(true); };
  // 버튼에서 팝오버로 마우스를 옮기는 사이에 닫히지 않도록 짧게 미룬다
  const hide = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 100); };

  React.useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const t = triggerRef.current!.getBoundingClientRect();
    const p = popRef.current!.getBoundingClientRect();
    const gap = 8, edge = 8;
    const above = t.top - p.height - gap;
    const top = above >= edge ? above : t.bottom + gap;
    const left = Math.min(Math.max(t.left + t.width / 2 - p.width / 2, edge), window.innerWidth - p.width - edge);
    setPos({ top, left });
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      suppressed.current = true;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!triggerRef.current?.contains(n) && !popRef.current?.contains(n)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", close, true); // 표·페이지가 움직이면 위치가 어긋나므로 닫는다
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  React.useEffect(() => () => clearTimeout(closeTimer.current), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="krds-tooltip"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerEnter={(e) => { pointerType.current = e.pointerType; if (e.pointerType === "mouse") { suppressed.current = false; show(); } }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(); }}
        onFocus={() => { if (suppressed.current) { suppressed.current = false; return; } show(); }}
        onBlur={() => { suppressed.current = false; hide(); }}
        onClick={() => { if (pointerType.current !== "mouse") setOpen((o) => !o); }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6.2 6.3a1.9 1.9 0 1 1 2.9 1.6c-.7.45-1.1.8-1.1 1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r=".9" fill="currentColor" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={popRef}
              id={id}
              role="tooltip"
              className="krds-tooltip-popover"
              style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
              onPointerEnter={show}
              onPointerLeave={hide}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
