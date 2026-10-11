/**
 * scripts/tsHooks.mjs
 *
 * 테스트 스크립트에서 src/lib/*.ts 를 node 로 직접 불러오기 위한 모듈 해석 훅.
 *
 * src/lib/ 안에서는 Next(번들러) 방식대로 확장자 없이 import 하는데
 * (`import { parseNote } from './noteParser'`), node 의 ESM 은 확장자를 요구한다.
 * 그래서 해석에 실패하면 ".ts" 를 붙여 한 번 더 시도한다.
 *
 * src/lib/ 코드를 테스트 때문에 바꾸지 않으려고 두는 파일이라, 이 훅은 scripts/ 안에서만 쓴다.
 */

/** 확장자 없는 상대경로 import 를 .ts 로 되짚어 준다. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // 상대경로인데 확장자가 없을 때만 재시도한다. (node_modules 해석은 건드리지 않는다)
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$|\.json$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
