package main

import "google.golang.org/genai"

func documentResponseSchema() *genai.Schema {
	return &genai.Schema{
		Type: genai.TypeObject,
		Properties: map[string]*genai.Schema{
			"document_type":    nullableEnum("NEW", "RENEWAL", "RECLASSIFICATION"),
			"application_date": nullableDate(),
			"applicant_info": {
				Type: genai.TypeObject,
				Properties: map[string]*genai.Schema{
					"applicant_name":           nullableString(),
					"applicant_relationship":   nullableString(),
					"submitter_agent_type":     nullableEnum(
						"COMMUNITY_GENERAL_SUPPORT_CENTER",
						"IN_HOME_CARE_SUPPORT_PROVIDER",
						"DESIGNATED_NURSING_HOME_FOR_THE_ELDERLY",
						"LONG_TERM_CARE_HEALTH_FACILITY",
						"INTEGRATED_MEDICAL_AND_CARE_FACILITY",
						"OTHER",
					),
					"submitter_agent_name": nullableString(),
					"applicant_address":  nullableString(),
					"applicant_phone":    nullableString(),
				},
			},
			"insured_person_info": {
				Type: genai.TypeObject,
				Properties: map[string]*genai.Schema{
					"insured_person_number": nullableString(),
					"personal_number":       nullableString(),
					"furigana":              nullableString(),
					"name":                  nullableString(),
					"birth_date":            nullableDate(),
					"gender":                nullableEnum("MALE", "FEMALE"),
					"address":               nullableString(),
					"phone":                 nullableString(),
				},
			},
			"previous_certification_results": {
				Type: genai.TypeObject,
				Properties: map[string]*genai.Schema{
					"previous_care_level":    nullableInteger(),
					"previous_support_level": nullableInteger(),
					"validity_period_start":  nullableDate(),
					"validity_period_end":    nullableDate(),
				},
			},
			"transfer_info": {
				Type: genai.TypeObject,
				Properties: map[string]*genai.Schema{
					"transferred_from_municipality":     nullableString(),
					"applying_in_previous_municipality": nullableBoolean(),
					"previous_application_date":         nullableDate(),
				},
			},
			"facility_admission_info": {
				Type: genai.TypeObject,
				Properties: map[string]*genai.Schema{
					"facility_admission": nullableBoolean(),
					"facility_name":      nullableString(),
					"facility_address":   nullableString(),
				},
			},
			"attending_physician": {
				Type: genai.TypeObject,
				Properties: map[string]*genai.Schema{
					"physician_name":           nullableString(),
					"medical_institution_name": nullableString(),
					"physician_address":        nullableString(),
					"physician_phone":          nullableString(),
				},
			},
			"category_2_insured": {
				Type: genai.TypeObject,
				Properties: map[string]*genai.Schema{
					"medical_insurer_name":     nullableString(),
					"medical_insurance_number": nullableString(),
					"specific_disease_name":    nullableString(),
				},
			},
			"consent_signatures": {
				Type: genai.TypeObject,
				Properties: map[string]*genai.Schema{
					"insured_signature_name":         nullableString(),
					"insured_signature_relationship": nullableString(),
					"proxy_penman_name":              nullableString(),
					"proxy_penman_address":           nullableString(),
				},
			},
		},
	}
}

func nullableString() *genai.Schema {
	return &genai.Schema{Type: genai.TypeString, Nullable: boolPtr(true)}
}

func nullableDate() *genai.Schema {
	return &genai.Schema{Type: genai.TypeString, Format: "date", Nullable: boolPtr(true)}
}

func nullableInteger() *genai.Schema {
	return &genai.Schema{Type: genai.TypeInteger, Nullable: boolPtr(true)}
}

func nullableBoolean() *genai.Schema {
	return &genai.Schema{Type: genai.TypeBoolean, Nullable: boolPtr(true)}
}

func nullableEnum(values ...string) *genai.Schema {
	return &genai.Schema{Type: genai.TypeString, Enum: values, Nullable: boolPtr(true)}
}

func boolPtr(v bool) *bool {
	return &v
}
