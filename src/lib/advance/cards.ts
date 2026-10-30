import { CARD_DEPARTMENTS, type CardDepartment, type CorporateCard } from "./types";

const STORAGE_KEY = "hanbit-demo-advance-cards-v2";

/** 데모용 가상 카드 4장. 실제 인물·카드번호와 무관하다. */
export const SEED_CARDS: CorporateCard[] = [
  { id: "kb-4471-kim-cheolsu", holderName: "김철수", cardCompany: "국민", department: "시공", last4: "4471", memo: "차장" },
  { id: "ibk-8206-lee-younghee", holderName: "이영희", cardCompany: "기업", department: "설계", last4: "8206", memo: "대리" },
  { id: "kb-3159-hong-gildong", holderName: "홍길동", cardCompany: "국민", department: "경영지원", last4: "3159", memo: "과장" },
  { id: "ibk-6023-park-minsu", holderName: "박민수", cardCompany: "기업", department: "공무", last4: "6023", memo: "주임" },
];

// localStorage가 막힌 환경(시크릿 창 등)에서는 메모리로만 유지한다.
let memory: CorporateCard[] | null = null;

// 예전에 저장된 부서명("(…)시공" 등)을 지금 이름으로 바꾼다. 알 수 없는 값은 비운다.
function normalizeDepartment(card: CorporateCard): CorporateCard {
  const value = card.department as string | undefined;
  if (!value || CARD_DEPARTMENTS.includes(value as CardDepartment)) return card;
  const matched = CARD_DEPARTMENTS.find((name) => value.includes(name));
  return { ...card, department: matched };
}

function load(): CorporateCard[] {
  if (memory) return memory;
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (text) return (memory = (JSON.parse(text) as CorporateCard[]).map(normalizeDepartment));
  } catch {
    // fall through to seed
  }
  return (memory = SEED_CARDS.map((card) => ({ ...card })));
}

function persist(cards: CorporateCard[]) {
  memory = cards;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // memory only
  }
}

export function listCards(): CorporateCard[] {
  return [...load()];
}

export function getCard(id: string) {
  return load().find((card) => card.id === id) ?? null;
}

export function saveCard(input: Omit<CorporateCard, "id"> & { id?: string }): CorporateCard {
  const cards = load();
  const last4 = input.last4.replace(/\D/g, "").slice(-4);
  if (last4.length !== 4) throw new Error("카드 끝 4자리를 입력해 주세요.");
  if (input.cardCompany !== "국민" && input.cardCompany !== "기업") throw new Error("카드사는 국민 또는 기업 중에서 골라 주세요.");
  if (!CARD_DEPARTMENTS.includes(input.department as CardDepartment)) throw new Error("소속을 선택해 주세요.");
  if (cards.some((card) => card.last4 === last4 && card.id !== input.id)) throw new Error("같은 끝 4자리 카드가 이미 등록돼 있어요.");

  const card: CorporateCard = {
    id: input.id || "card-" + Date.now(),
    holderName: input.holderName.trim(),
    cardCompany: input.cardCompany,
    department: input.department,
    last4,
    memo: input.memo?.trim() || undefined,
  };
  if (!card.holderName) throw new Error("카드 사용자 이름을 입력해 주세요.");

  persist(cards.some((item) => item.id === card.id) ? cards.map((item) => (item.id === card.id ? card : item)) : [card, ...cards]);
  return card;
}

export function deleteCard(id: string) {
  persist(load().filter((card) => card.id !== id));
}

/** 테스트·초기화용. */
export function resetCards() {
  memory = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
