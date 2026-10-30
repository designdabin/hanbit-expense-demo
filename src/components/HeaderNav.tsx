"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Emoji } from "@/components/DemoShell";

// 아이콘은 홈 카드와 같은 토스 이모지를 써서 메뉴와 카드가 한 짝으로 보이게 한다
const tabs = [
  { href: "/demo/advance/", label: "경비 정산서 자동 작성", emoji: "📝" },
  { href: "/demo/audit/", label: "경비 규정 준수 확인", emoji: "🔍" },
];

const trim = (p: string) => p.replace(/\/+$/, "");

/** 헤더 GNB. 지금 보고 있는 화면의 메뉴에 aria-current="page" 를 달아 선택 상태(.header-link[aria-current])로 보여 준다. */
export function HeaderNav() {
  const path = trim(usePathname() ?? "");
  return (
    <nav className="header-nav" aria-label="데모 메뉴">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="header-link" aria-current={path === trim(t.href) ? "page" : undefined}>
          <Emoji size={20}>{t.emoji}</Emoji>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
