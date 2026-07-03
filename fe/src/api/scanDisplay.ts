// Formatters that turn the /scan_document AI response values back into the
// Japanese wording used on the paper 介護保険 申請書. The backend schema is
// prompt-enforced only, so unknown values fall through to a readable raw form
// instead of throwing.

export const EMPTY_VALUE = "未記入";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  NEW: "新規申請",
  RENEWAL: "更新申請",
  RECLASSIFICATION: "区分変更申請",
};

const GENDER_LABELS: Record<string, string> = {
  MALE: "男",
  FEMALE: "女",
};

const SUBMITTER_AGENT_LABELS: Record<string, string> = {
  COMMUNITY_GENERAL_SUPPORT_CENTER: "地域包括支援センター",
  IN_HOME_CARE_SUPPORT_PROVIDER: "居宅介護支援事業者",
  DESIGNATED_NURSING_HOME_FOR_THE_ELDERLY: "指定介護老人福祉施設",
  LONG_TERM_CARE_HEALTH_FACILITY: "介護老人保健施設",
  INTEGRATED_MEDICAL_AND_CARE_FACILITY: "介護医療院",
  OTHER: "その他",
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: "本人",
  spouse: "配偶者",
  husband: "夫",
  wife: "妻",
  eldest_son: "長男",
  second_son: "次男",
  third_son: "三男",
  son: "息子",
  eldest_daughter: "長女",
  second_daughter: "次女",
  third_daughter: "三女",
  daughter: "娘",
  father: "父",
  mother: "母",
  parent: "父母",
  grandchild: "孫",
  sibling: "兄弟姉妹",
  brother: "兄弟",
  sister: "姉妹",
  relative: "親族",
  care_manager: "ケアマネジャー",
  guardian: "成年後見人",
};

function mapOrRaw(labels: Record<string, string>, value: string | null | undefined): string {
  if (value == null || value === "") return EMPTY_VALUE;
  return labels[value] ?? value.replace(/_/g, " ");
}

export function formatDocumentType(value: string | null | undefined): string {
  return mapOrRaw(DOCUMENT_TYPE_LABELS, value);
}

export function formatGender(value: string | null | undefined): string {
  return mapOrRaw(GENDER_LABELS, value);
}

export function formatSubmitterAgentType(value: string | null | undefined): string {
  return mapOrRaw(SUBMITTER_AGENT_LABELS, value);
}

export function formatRelationship(value: string | null | undefined): string {
  return mapOrRaw(RELATIONSHIP_LABELS, value);
}

export function formatPresence(value: boolean | null | undefined): string {
  if (value == null) return EMPTY_VALUE;
  return value ? "有" : "無";
}

export function formatYesNo(value: boolean | null | undefined): string {
  if (value == null) return EMPTY_VALUE;
  return value ? "はい" : "いいえ";
}

export function formatCareLevel(value: number | null | undefined): string {
  return value == null ? EMPTY_VALUE : `要介護${value}`;
}

export function formatSupportLevel(value: number | null | undefined): string {
  return value == null ? EMPTY_VALUE : `要支援${value}`;
}

export function formatDateJa(value: string | null | undefined): string {
  if (value == null || value === "") return EMPTY_VALUE;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

export function formatText(value: string | null | undefined): string {
  return value == null || value === "" ? EMPTY_VALUE : value;
}
