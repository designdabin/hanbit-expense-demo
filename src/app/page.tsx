import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CardContent, CardDescription, CardTitle } from "@/components/ui/card";

const cards = [
  { href: "/demo/advance/", title: "경비 정산서 자동 작성", desc: "카드 사용내역 엑셀을 올리면 회사에 낼 경비 정산서를 자동으로 채워 줍니다.", tag: "매월 손으로 옮기던 작업" },
  { href: "/demo/audit/", title: "경비 규칙 위반 찾기", desc: "작성한 정산서를 회사 경비 규칙과 비교해 한도를 넘었거나 쓰면 안 되는 곳에 쓴 내역을 찾아 줍니다.", tag: "눈으로 하던 검수" },
];

export default function Home() {
  return (
    <section className="workflow-shell">
      <div className="hero">
        <h2>법인카드 경비 처리, 직접 체험해 보세요</h2>
        <p>
          직원이 법인카드로 쓴 내역을 경비 정산서(회사에서는 ‘전도금 신청서’라 불러요)로 자동 정리하고, 회사 경비 규칙에 어긋난 사용까지 찾아내는 시스템입니다. 한빛건설 사내 시스템을 재구성한 데모로, 두 가지 핵심 기능을 직접 체험해 볼 수 있습니다.
        </p>
      </div>
      <Alert className="alert-info">
        <AlertDescription>
          이 사이트에서 다루는 회사명·인물·카드번호 등 모든 데이터는 가상입니다. 실제 개인정보나 업무 데이터는 사용하지 않습니다.
        </AlertDescription>
      </Alert>
      <div className="feature-grid">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="ui-card feature-card">
            <CardContent>
              <Badge variant="secondary">{c.tag}</Badge>
              <CardTitle>{c.title}</CardTitle>
              <CardDescription>{c.desc}</CardDescription>
              <span className="feature-cta">체험하기 →</span>
            </CardContent>
          </Link>
        ))}
      </div>
    </section>
  );
}
