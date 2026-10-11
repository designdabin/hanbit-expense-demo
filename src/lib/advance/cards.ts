import { CARD_DEPARTMENTS, type CardDepartment, type CorporateCard } from "./types";

const STORAGE_KEY = "hanbit-demo-advance-cards";

/** 데모용 가상 카드 4장. 실제 인물·카드번호와 무관하다. */
export const SEED_CARDS: CorporateCard[] = [
  { id: "kb-4471-lee-seojun", holderName: "이서준", cardCompany: "국민", department: "(건축/인테리어)시공", last4: "4471", memo: "차장" },
  { id: "ibk-8206-jung-hayun", holderName: "정하윤", cardCompany: "기업", department: "(건축/인테리어)디자인&설계", last4: "8206", memo: "대리" },
  { id: "kb-3159-oh-minjae", holderName: "오민재", cardCompany: "국민", department: "경영지원", last4: "3159", memo: "과장" },
  { id: "ibk-6023-han-jiwoo", holderName: "한지우", cardCompany: "기업", department: "공무", last4: "6023", memo: "주임" },
];

// localStorage가 막힌 환경(시크릿 창 등)에서는 메모리로만 유지한다.
let memory: CorporateCard[] | null = null;

function load(): CorporateCard[] {
  if (memory) return memory;
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (text) return (memory = JSON.parse(text) as CorporateCard[]);
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
  if (input.cardCompany !== "국민" && input.cardCompany !== "기업") throw new Error("카드사는 국민 또는 기업만 선택할 수 있습니다.");
  if (!CARD_DEPARTMENTS.includes(input.department as CardDepartment)) throw new Error("소속을 선택해 주세요.");
  if (cards.some((card) => card.last4 === last4 && card.id !== input.id)) throw new Error("같은 끝 4자리 카드가 이미 등록되어 있습니다.");

  const card: CorporateCard = {
    id: input.id || "card-" + Date.now(),
    holderName: input.holderName.trim(),
    cardCompany: input.cardCompany,
    department: input.department,
    last4,
    memo: input.memo?.trim() || undefined,
  };
  if (!card.holderName) throw new Error("카드 담당자 이름을 입력해 주세요.");

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
