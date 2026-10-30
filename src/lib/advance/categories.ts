import type { ExpenseCategoryKey } from "./types";

export const EXPENSE_CATEGORIES: Record<ExpenseCategoryKey, { name: string; column: "H" | "I" | "J" | "K" | "L" | "M"; keywords: string[] }> = {
  welfare: {
    name: "복리후생비",
    column: "H",
    keywords: ["한식", "중식", "일식", "양식", "음식", "식당", "커피", "카페", "음료", "편의점", "휴게", "맥도날드", "카츠", "메가", "GS25", "CU", "세븐", "이마트24"],
  },
  fuel: {
    name: "주유비",
    column: "I",
    keywords: ["주유", "충전소", "가스", "LPG"],
  },
  travel: {
    name: "여비교통비",
    column: "J",
    keywords: ["택시", "대중교통", "주차", "통행료", "하이패스", "철도", "고속", "버스", "교통", "구청"],
  },
  supplies: {
    name: "물품구입비",
    column: "K",
    keywords: ["철물", "자재", "마트", "다이소", "문구", "공구", "건재", "용품"],
  },
  delivery: {
    name: "운송비",
    column: "L",
    keywords: ["택배", "퀵", "배송", "운송"],
  },
  etc: {
    name: "기타",
    column: "M",
    keywords: [],
  },
};

export function recommendCategory(input: string): ExpenseCategoryKey {
  const normalized = input.replace(/\s+/g, "").toLowerCase();
  const entries = Object.entries(EXPENSE_CATEGORIES) as Array<[ExpenseCategoryKey, (typeof EXPENSE_CATEGORIES)[ExpenseCategoryKey]]>;
  for (const [key, category] of entries) {
    if (key === "etc") continue;
    if (category.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) return key;
  }
  return "etc";
}
