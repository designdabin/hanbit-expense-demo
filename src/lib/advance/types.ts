export type CardCompany = "국민" | "기업";

export type CardDepartment =
  | "(건축/인테리어)시공"
  | "(건축/인테리어)디자인&설계"
  | "경영지원"
  | "공무";

export const CARD_DEPARTMENTS: CardDepartment[] = [
  "(건축/인테리어)시공",
  "(건축/인테리어)디자인&설계",
  "경영지원",
  "공무",
];

export type CorporateCard = {
  id: string;
  holderName: string;
  cardCompany: CardCompany;
  department?: CardDepartment;
  last4: string;
  memo?: string;
};

export type ExpenseCategoryKey =
  | "welfare"
  | "fuel"
  | "travel"
  | "supplies"
  | "delivery"
  | "etc";

export type ApprovalRow = {
  id: string;
  approvalDate: string;
  merchant: string;
  amount: number;
  cardNumber?: string;
  approvalNumber?: string;
  businessNumber?: string;
  industry?: string;
  status?: string;
  categoryKey: ExpenseCategoryKey;
  categoryName: string;
  categoryColumn: "H" | "I" | "J" | "K" | "L" | "M";
};

export type PreviewResponse = {
  card: CorporateCard;
  month: string;
  rows: ApprovalRow[];
  cancelledRows: ApprovalRow[];
  totals: Record<ExpenseCategoryKey | "all", number>;
  warnings: string[];
};
