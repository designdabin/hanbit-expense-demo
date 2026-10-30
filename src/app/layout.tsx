import type { Metadata } from "next";
import Link from "next/link";
import { HeaderNav } from "@/components/HeaderNav";
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "한빛건설 법인카드 경비 전산 | 수기 경비 정산 업무의 전산화",
  description: "수기로 하던 법인카드 경비 정산 업무를 전산화한 시스템을 가상 데이터로 재구성한 데모예요. 경비 정산서 자동 작성과 경비 규정 준수 확인을 체험해 보세요.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <main className="app-shell">
          <header className="app-header">
            <div className="header-inner">
              <Link href="/" className="header-home" aria-label="한빛건설 법인카드 경비 전산 홈">
                <span className="header-mark" aria-hidden="true">한</span>
                <span className="header-brand">한빛건설</span>
                <span className="header-divider" aria-hidden="true" />
                <span className="header-site">법인카드 경비 전산</span>
              </Link>
              <HeaderNav />
            </div>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
