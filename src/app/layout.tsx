import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "한빛건설 경비 자동화 데모",
  description: "법인카드 경비 정산서 자동 작성과 경비 규칙 위반 찾기를 직접 체험해 보는 데모 (가상 데이터)",
};

const tabs = [
  { href: "/demo/advance/", label: "정산서 자동 작성" },
  { href: "/demo/audit/", label: "규칙 위반 찾기" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <main className="app-shell">
          <header className="app-header">
            <div className="header-inner">
              <div className="header-title-group">
                <Link href="/" className="header-brand" style={{ textDecoration: "none" }}>한빛건설</Link>
                <h1>경비 자동화 데모</h1>
              </div>
              <nav className="header-nav" aria-label="데모 메뉴">
                {tabs.map((t) => <Link key={t.href} href={t.href} className="header-link">{t.label}</Link>)}
              </nav>
              <span className="header-spacer" />
              <span className="demo-badge">데모 · 가상 데이터</span>
            </div>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
