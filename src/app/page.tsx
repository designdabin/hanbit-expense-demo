import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Emoji } from "@/components/DemoShell";
import { CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { clauses } from "@/components/ui/clauses";

const cards = [
  { href: "/demo/advance/", title: "경비 정산서 자동 작성", desc: "카드사에서 받은 엑셀 파일을 업로드하면, 취소된 결제는 제외하고, 날짜·사용처·금액이 담긴 경비 정산서 엑셀 파일을 만들어요.", before: "카드 내역을 수기로 옮겨 적었어요", after: "엑셀만 업로드하면 정산서가 완성돼요", emoji: "📝" },
  { href: "/demo/audit/", title: "경비 규정 준수 확인", desc: "완성된 경비 정산서를 업로드하면 식비·음료가 한도를 지켰는지, 결제가 금지된 주차비는 없는지 확인하고, 규정에 어긋난 내역을 구분해 표시해요.", before: "엑셀을 육안으로 대조했어요", after: "규정에 어긋난 내역만 바로 구분해요", emoji: "🔍" },
];

export default function Home() {
  return (
    <section className="workflow-shell">
      <div className="hero">
        <h1>{clauses("수기 경비 정산 업무의 전산화")}</h1>
        <p>
          <span className="hero-line">실제 회사 업무용으로 개발한 법인카드 경비 전산 시스템을 가상 데이터로 재구성한 데모예요.</span>
          <span className="hero-line">엑셀에 직접 옮겨 적고 육안으로 확인하던 정산 업무를 시스템이 대신 처리해요.</span>
          <span className="hero-line">샘플 파일로 정산서 작성부터 규정에 어긋난 내역 확인까지 체험해 보세요.</span>
        </p>
      </div>
      <Alert className="alert-info">
        <AlertDescription>
          이 사이트의 회사명·인물·카드번호는 모두 가상이에요. 실제 개인정보나 업무 데이터는 사용하지 않아요.
        </AlertDescription>
      </Alert>
      <div className="feature-grid">
        {cards.map((c) => (
          <div key={c.href} className="ui-card feature-card">
            <CardContent>
              <span className="feature-emoji"><Emoji>{c.emoji}</Emoji></span>
              <CardTitle>{c.title}</CardTitle>
              <CardDescription>{c.desc}</CardDescription>
              <dl className="feature-compare">
                <div><dt>이전</dt><dd>{c.before}</dd></div>
                <div><dt>현재</dt><dd>{c.after}</dd></div>
              </dl>
              <Link href={c.href} className="feature-cta" aria-label={c.title + " 체험하기"}><span className="ui-button ui-button-default">체험하기 →</span></Link>
            </CardContent>
          </div>
        ))}
      </div>
    </section>
  );
}
