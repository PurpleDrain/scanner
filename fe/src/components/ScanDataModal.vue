<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ScanAiResponse } from "../api/scanDocument";
import {
  EMPTY_VALUE,
  formatCareLevel,
  formatDateJa,
  formatDocumentType,
  formatGender,
  formatPresence,
  formatRelationship,
  formatSubmitterAgentType,
  formatSupportLevel,
  formatText,
  formatYesNo,
} from "../api/scanDisplay";

const props = defineProps<{
  open: boolean;
  data: ScanAiResponse | null;
}>();

defineEmits<{
  close: [];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!dialogRef.value) return;
    if (open && !dialogRef.value.open) dialogRef.value.showModal();
    else if (!open && dialogRef.value.open) dialogRef.value.close();
  },
  { flush: "post" },
);

type Row = [string, string];
interface Group {
  subhead: string | null;
  rows: Row[];
}
interface Section {
  title: string;
  groups: Group[];
}

const sections = computed<Section[]>(() => {
  const d = props.data;
  if (!d) return [];
  const applicant = d.applicant_info;
  const insured = d.insured_person_info;
  const prevCert = d.previous_certification_results;
  const transfer = d.transfer_info;
  const facility = d.facility_admission_info;
  const physician = d.attending_physician;
  const category2 = d.category_2_insured;
  const consent = d.consent_signatures;

  return [
    {
      title: "申請者・提出代行者",
      groups: [
        {
          subhead: null,
          rows: [
            ["申請者氏名", formatText(applicant?.applicant_name)],
            ["本人との関係", formatRelationship(applicant?.applicant_relationship)],
            ["提出代行者（区分）", formatSubmitterAgentType(applicant?.submitter_agent_type)],
            ["提出代行者（名称）", formatText(applicant?.submitter_agent_name)],
            ["住所", formatText(applicant?.applicant_address)],
            ["電話番号", formatText(applicant?.applicant_phone)],
          ],
        },
      ],
    },
    {
      title: "被保険者",
      groups: [
        {
          subhead: null,
          rows: [
            ["被保険者番号", formatText(insured?.insured_person_number)],
            ["個人番号", formatText(insured?.personal_number)],
            ["フリガナ", formatText(insured?.furigana)],
            ["氏名", formatText(insured?.name)],
            ["生年月日", formatDateJa(insured?.birth_date)],
            ["性別", formatGender(insured?.gender)],
            ["住所", formatText(insured?.address)],
            ["電話番号", formatText(insured?.phone)],
          ],
        },
        {
          subhead: "前回の要介護認定の結果等",
          rows: [
            [
              "要介護状態区分",
              prevCert?.previous_care_level == null ? EMPTY_VALUE : formatCareLevel(prevCert.previous_care_level),
            ],
            [
              "要支援状態区分",
              prevCert?.previous_support_level == null
                ? EMPTY_VALUE
                : formatSupportLevel(prevCert.previous_support_level),
            ],
            ["有効期間（開始）", formatDateJa(prevCert?.validity_period_start)],
            ["有効期間（終了）", formatDateJa(prevCert?.validity_period_end)],
          ],
        },
        {
          subhead: "転入情報（他自治体からの転入）",
          rows: [
            ["転出元自治体", formatText(transfer?.transferred_from_municipality)],
            ["転出元自治体へ申請中", formatYesNo(transfer?.applying_in_previous_municipality)],
            ["申請日", formatDateJa(transfer?.previous_application_date)],
          ],
        },
        {
          subhead: "介護保険施設への入所",
          rows: [
            ["入所の有無", formatPresence(facility?.facility_admission)],
            ["入所施設名", formatText(facility?.facility_name)],
            ["施設所在地", formatText(facility?.facility_address)],
          ],
        },
      ],
    },
    {
      title: "主治医",
      groups: [
        {
          subhead: null,
          rows: [
            ["主治医の氏名", formatText(physician?.physician_name)],
            ["医療機関名", formatText(physician?.medical_institution_name)],
            ["所在地", formatText(physician?.physician_address)],
            ["電話番号", formatText(physician?.physician_phone)],
          ],
        },
      ],
    },
    {
      title: "第2号被保険者（40歳から64歳の方）",
      groups: [
        {
          subhead: null,
          rows: [
            ["医療保険者名", formatText(category2?.medical_insurer_name)],
            ["被保険者証 記号・番号", formatText(category2?.medical_insurance_number)],
            ["特定疾病名", formatText(category2?.specific_disease_name)],
          ],
        },
      ],
    },
    {
      title: "同意・署名",
      groups: [
        {
          subhead: null,
          rows: [
            ["本人氏名", formatText(consent?.insured_signature_name)],
            ["本人との関係", formatRelationship(consent?.insured_signature_relationship)],
            ["代筆者氏名", formatText(consent?.proxy_penman_name)],
            ["代筆者住所", formatText(consent?.proxy_penman_address)],
          ],
        },
      ],
    },
  ];
});
</script>

<template>
  <dialog ref="dialogRef" class="app-modal app-modal-full">
    <div class="modal-header">
      <h2>読み取り結果の確認</h2>
      <button class="icon-btn modal-close" type="button" aria-label="閉じる" @click="$emit('close')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="modal-body modal-body-scroll scan-form-body">
      <p class="scan-form-note">読み取った内容をご確認ください。読み取れなかった項目は「未記入」と表示されます。</p>
      <div class="scan-form-title">
        <h3>介護保険 要介護認定・要支援認定申請書</h3>
        <dl class="scan-form-grid">
          <dt>申請区分</dt>
          <dd>{{ formatDocumentType(data?.document_type) }}</dd>
          <dt>申請年月日</dt>
          <dd>{{ formatDateJa(data?.application_date) }}</dd>
        </dl>
      </div>
      <section v-for="section in sections" :key="section.title" class="scan-form-section">
        <h3 class="scan-form-section-title">{{ section.title }}</h3>
        <template v-for="(group, i) in section.groups" :key="i">
          <h4 v-if="group.subhead" class="scan-form-subhead">{{ group.subhead }}</h4>
          <dl class="scan-form-grid">
            <template v-for="[label, value] in group.rows" :key="label">
              <dt>{{ label }}</dt>
              <dd :class="{ 'scan-value-empty': value === EMPTY_VALUE }">{{ value }}</dd>
            </template>
          </dl>
        </template>
      </section>
    </div>
    <footer class="modal-footer">
      <button class="primary-btn" type="button" @click="$emit('close')">確認しました</button>
    </footer>
  </dialog>
</template>
