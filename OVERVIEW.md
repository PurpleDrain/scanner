# Scanner POC — Overview

A **document scanner + AI extraction** proof of concept for Japanese nursing-care insurance application forms (要介護認定申請書).

## What it does

### 1. Scan a document (frontend, entirely client-side)

- Open the camera (or pick from gallery)
- An on-device ML model (DocAligner, running via ONNX in a web worker) detects the document's corners live, in real time
- User captures the shot, then can fine-tune the four corners in a modal
- The image is perspective-corrected ("flattened") using a WebGL homography warp, with a quality score (blur/lighting/etc.) and optional contrast enhancement
- Result preview lets the user download the image or submit it for extraction

### 2. Extract structured data (backend, Go)

- The flattened image is uploaded to a Go server (`POST /scan_document`)
- The server sends it to **Google Gemini** (via Vertex AI) with a detailed system prompt telling it to act as an OCR engine for this specific form
- The prompt handles Japanese-specific quirks: circled/selected checkbox values, Wareki (era) date conversion to ISO dates, mapping Japanese labels to English enums, etc.
- Gemini returns structured JSON (applicant info, insured person info, certification results, physician info, etc.)

### 3. Display results (frontend)

- The extracted JSON is formatted back into Japanese labels/values and shown in a results modal

## Tech stack

| Layer | Stack |
|-------|-------|
| **Frontend** | Vue 3, TypeScript, Vite, Tailwind CSS |
| **On-device ML** | `onnxruntime-web` + DocAligner (web worker) |
| **Image processing** | WebGL homography warp, Canvas2D quality metrics |
| **Backend** | Go, `google.golang.org/genai`, `godotenv` |
| **AI** | Google Gemini (`gemini-3.5-flash`) via Vertex AI Enterprise |
| **Dev tooling** | Air (Go hot-reload), Vitest (FE tests), HTTPS dev server for camera access |

## Flow

```
Camera/Gallery → ML corner detection → manual correction → flatten (WebGL)
   → upload to Go backend → Gemini OCR extraction → display structured Japanese form data
```

All scanning (detection, cropping, flattening) happens in the browser. The backend's only job is to take the final image and turn it into structured data via Gemini.

## Notable details

- Vite proxies `/api/*` to the Go server on `localhost:8080` (dev setup)
- The Gemini JSON response schema (`be/response_schema.go`) is defined but currently **commented out** in `be/main.go` — the model is guided only by the prompt text, not an enforced schema
- The root `README.md` still describes the original browser-only scanner PoC and doesn't yet mention the backend/OCR extension
</contents>
</invoke>
