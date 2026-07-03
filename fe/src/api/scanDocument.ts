// Client for the Go backend's POST /scan_document endpoint.
// The response shape mirrors be/system_prompt.txt; the backend does not
// enforce a schema (prompt-only), so every leaf is nullable and consumers
// must tolerate missing nested objects.

export type DocumentType = "NEW" | "RENEWAL" | "RECLASSIFICATION";
export type Gender = "MALE" | "FEMALE";
export type SubmitterAgentType =
  | "COMMUNITY_GENERAL_SUPPORT_CENTER"
  | "IN_HOME_CARE_SUPPORT_PROVIDER"
  | "DESIGNATED_NURSING_HOME_FOR_THE_ELDERLY"
  | "LONG_TERM_CARE_HEALTH_FACILITY"
  | "INTEGRATED_MEDICAL_AND_CARE_FACILITY"
  | "OTHER";

export interface ApplicantInfo {
  applicant_name: string | null;
  applicant_relationship: string | null;
  submitter_agent_type: SubmitterAgentType | null;
  submitter_agent_name: string | null;
  applicant_address: string | null;
  applicant_phone: string | null;
}

export interface InsuredPersonInfo {
  insured_person_number: string | null;
  personal_number: string | null;
  furigana: string | null;
  name: string | null;
  birth_date: string | null;
  gender: Gender | null;
  address: string | null;
  phone: string | null;
}

export interface PreviousCertificationResults {
  previous_care_level: number | null;
  previous_support_level: number | null;
  validity_period_start: string | null;
  validity_period_end: string | null;
}

export interface TransferInfo {
  transferred_from_municipality: string | null;
  applying_in_previous_municipality: boolean | null;
  previous_application_date: string | null;
}

export interface FacilityAdmissionInfo {
  facility_admission: boolean | null;
  facility_name: string | null;
  facility_address: string | null;
}

export interface AttendingPhysician {
  physician_name: string | null;
  medical_institution_name: string | null;
  physician_address: string | null;
  physician_phone: string | null;
}

export interface Category2Insured {
  medical_insurer_name: string | null;
  medical_insurance_number: string | null;
  specific_disease_name: string | null;
}

export interface ConsentSignatures {
  insured_signature_name: string | null;
  insured_signature_relationship: string | null;
  proxy_penman_name: string | null;
  proxy_penman_address: string | null;
}

export interface ScanAiResponse {
  document_type: DocumentType | null;
  application_date: string | null;
  applicant_info: ApplicantInfo | null;
  insured_person_info: InsuredPersonInfo | null;
  previous_certification_results: PreviousCertificationResults | null;
  transfer_info: TransferInfo | null;
  facility_admission_info: FacilityAdmissionInfo | null;
  attending_physician: AttendingPhysician | null;
  category_2_insured: Category2Insured | null;
  consent_signatures: ConsentSignatures | null;
}

export interface ScanDocumentResponse {
  filename: string;
  size: number;
  mime: string;
  ai_response: ScanAiResponse;
}

export const SCAN_FAILED_MESSAGE = "読み取りに失敗しました。お手数ですが、もう一度お試しください。";
export const SCAN_NETWORK_MESSAGE =
  "サーバーに接続できませんでした。通信環境をご確認のうえ、もう一度お試しください。";

// Gemini runs with high thinking; a scan can take a minute or more.
const SCAN_TIMEOUT_MS = 180_000;

export async function scanDocument(image: Blob, signal?: AbortSignal): Promise<ScanDocumentResponse> {
  const form = new FormData();
  form.append("document_file", image, "scan.jpg");

  let res: Response;
  try {
    res = await fetch("/api/scan_document", {
      method: "POST",
      body: form,
      signal: signal ?? AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("scan_document request failed:", err);
    throw new Error(SCAN_NETWORK_MESSAGE);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // non-JSON error body
    }
    console.error(`scan_document failed: HTTP ${res.status}`, detail);
    throw new Error(SCAN_FAILED_MESSAGE);
  }

  return (await res.json()) as ScanDocumentResponse;
}
