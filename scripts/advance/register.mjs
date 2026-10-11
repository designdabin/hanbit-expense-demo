// Node 로 src/lib/advance/*.ts 를 그대로 실행하기 위한 최소 로더: 확장자 없는 상대 import 에 .ts 를 붙여 준다.
// 사용: node --import ./scripts/advance/register.mjs --test scripts/advance/advance.test.mts
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\\.[cm]?[jt]sx?$|\\.json$/.test(specifier)) {
    try { return await next(specifier + ".ts", context); } catch {}
  }
  return next(specifier, context);
}
`));
