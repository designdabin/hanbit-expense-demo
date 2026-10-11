/**
 * scripts/audit/testSamples.mjs
 *
 * public/samples(화면용)·scripts/fixtures(테스트 전용)의 전도금신청서 샘플을 파싱·판정해 기대값과 대조한다.
 *   node scripts/audit/testSamples.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./tsHooks.mjs', import.meta.url);
const { parseEuljiFile } = await import('../../src/lib/audit/euljiParser.ts');
const { audit } = await import('../../src/lib/audit/expenseRules.ts');
const rules = JSON.parse(readFileSync(new URL('../../src/lib/audit/expenseRules.json', import.meta.url), 'utf8'));

const EXPECTED = {
  '전도금신청서_2026년04월분_김서연.xlsx': { owner: '김서연', checked: 8, violations: 1, review: 0, meal: 1000, drink: 0, parking: 0, total: 1000, parkingRef: 1 },
  '전도금신청서_2026년04월분_홍길동.xlsx': { owner: '홍길동', checked: 12, violations: 6, review: 2, meal: 19000, drink: 5000, parking: 80000, total: 104000, parkingRef: 1 },
  '전도금신청서_2026년04월분_이도윤.xlsx': { owner: '이도윤', checked: 8, violations: 3, review: 1, meal: 4000, drink: 500, parking: 25000, total: 29500, parkingRef: 0 },
};

let failed = 0;
for (const [name, want] of Object.entries(EXPECTED)) {
  const pub = new URL(`../../public/samples/${name}`, import.meta.url);
  const buf = readFileSync(existsSync(pub) ? pub : new URL(`../fixtures/${name}`, import.meta.url));
  const parsed = parseEuljiFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name);
  const r = audit(parsed, rules);
  const got = {
    owner: r.ownerName, checked: r.totalChecked, violations: r.violations.length, review: r.needsReview.length,
    meal: r.mealExcess, drink: r.drinkExcess, parking: r.parkingBanned, total: r.totalDeduction, parkingRef: r.parkingReference.length,
  };
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}`, ok ? JSON.stringify(got) : `\n   기대 ${JSON.stringify(want)}\n   실제 ${JSON.stringify(got)}`);
  // 합계 함정 행(999999999)이 읽히지 않았는지
  if (parsed.rows.some((x) => x.amount >= 999999999)) { failed += 1; console.log('❌ 합계 함정 행이 데이터로 읽힘'); }
}
console.log(failed === 0 ? '\n샘플 검증 통과' : `\n샘플 검증 ${failed}건 실패`);
process.exit(failed ? 1 : 0);
