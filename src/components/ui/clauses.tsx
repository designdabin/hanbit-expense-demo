import * as React from "react";

const OPEN = "(（";
const CLOSE = ")）";
const QUOTES = "'\"‘’“”";

/**
 * 문장 끝(. ? !)이나 쉼표(,) 뒤 공백에서 자른다.
 * 단, 괄호 안이나 따옴표 안, 그리고 "12,000원"처럼 쉼표 뒤에 공백이 없는 곳은 자르지 않는다.
 */
function splitClauses(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    else if (QUOTES.includes(ch)) quoted = !quoted;
    else if (",.!?".includes(ch) && depth === 0 && !quoted && /\s/.test(text[i + 1] ?? "")) {
      parts.push(text.slice(start, i + 1));
      while (/\s/.test(text[i + 1] ?? "")) i++;
      start = i + 1;
    }
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

/**
 * 줄바꿈이 문장·쉼표 단위로 일어나도록 문구를 마디(.clause = inline-block)로 묶는다.
 * 한 마디가 한 줄보다 길 때만 마디 안에서 줄이 바뀐다. 글자만 있는 children(문자열·숫자)에만 적용하고,
 * 다른 요소(<b> 등)가 섞여 있으면 그대로 돌려준다.
 */
export function clauses(children: React.ReactNode): React.ReactNode {
  const nodes = React.Children.toArray(children);
  if (nodes.length === 0 || !nodes.every((n) => typeof n === "string" || typeof n === "number")) return children;
  const parts = splitClauses(nodes.join("").trim());
  if (parts.length < 2) return children;
  return parts.map((part, i) => (
    <React.Fragment key={i}>
      {i > 0 ? " " : null}
      <span className="clause">{part}</span>
    </React.Fragment>
  ));
}
