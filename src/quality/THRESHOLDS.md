# Document quality thresholds

`src/quality/config.ts` defines `DEFAULT_QUALITY_CONFIG`, the thresholds the
quality module uses to turn raw measurements (Laplacian variance, mean
brightness, glare coverage %, corner-angle deviation, corrected width) into
0-100 scores and severity labels. This document explains where each default
came from and how to recalibrate it once real outcome data exists.

**Important caveat:** these are engineering heuristics based on common
practice for blur/exposure/perspective detection and on rough assumptions
about Japanese document text density — not values fit to a labeled corpus of
real Japanese medical document photos and their actual OCR/VLM success rates.
Treat them as a reasonable starting point, not ground truth. All of them are
passed as plain config objects (`QualityConfig`), so they can be overridden
per call to `analyzeDocumentQuality()` without touching this code.

## Blur (`BlurThresholds`)

Measured as the variance of the Laplacian of the grayscale image
(`computeBlurMetric`): a sharp image has high-frequency edge content, so the
second derivative has high variance; a blurred image's edges are smoothed
out, lowering it. This is a long-standing, well-known no-reference blur
proxy (commonly cited threshold for "is this photo blurry" is ~100, e.g. in
OpenCV community tutorials) and was chosen specifically because it requires
no model and runs in a couple of `cv` calls.

| Threshold | Value | Rationale |
|---|---|---|
| `excellentVariance` | 800 | Well above the ~100 "blurry" rule of thumb seen in practice; chosen as a comfortable margin so genuinely sharp, well-focused captures of dense kanji text (which have lots of fine strokes/edges and so naturally score higher than e.g. a photo of a smooth wall) land at 100. |
| `goodVariance` | 400 | Midpoint between acceptable and excellent; small/medium kanji strokes are still legible here. |
| `acceptableVariance` | 200 | Double the commonly-cited "blurry" cutoff (100); below this, fine kanji strokes (which need more resolved detail than Latin glyphs) start to merge under OCR. |
| `poorVariance` | 80 | Just under the common ~100 "blurry" cutoff; below this an OCR/VLM pass is unlikely to extract meaningful text reliably. |

Variance of Laplacian scales with image resolution and content density (more
edges = higher variance even in focus), so these defaults assume the
"typical phone photo of an A4/A5 medical document, filling most of the
frame" use case described in the original request. If documents are
captured at very different resolutions or zoom levels than that, recalibrate
by collecting variance values across a labeled sharp/blurry set and refitting
the four anchor points.

## Brightness (`BrightnessThresholds`)

Measured as mean grayscale intensity (0-255) of the corrected document crop.

| Threshold | Value | Rationale |
|---|---|---|
| `idealMean` | 175 | A scanned/photographed white or off-white page under reasonable lighting typically reads in the 160-190 range; 175 is the midpoint, used as the peak of the triangular score function. |
| `underexposedMean` | 90 | Below this, shadow or backlighting is likely suppressing midtone contrast that OCR binarization depends on. |
| `overexposedMean` | 245 | Above this, the page is nearly blown out to white; text strokes (especially fine kanji strokes) are at high risk of being clipped away entirely. |

Brightness is intentionally **not** included in the weighted overall score
(see `scoring/overall.ts`) — the literal spec's weights (40/30/20/10) sum to
100% across blur/glare/perspective/resolution only. Brightness is still
computed, surfaced as its own diagnostic, and feeds recommendations.

## Glare (`GlareThresholds`)

Glare/specular highlights are detected as pixels that are simultaneously
bright (high HSV "Value") *and* desaturated (low HSV "Saturation") —
`computeGlareMetric`. Plain white paper under normal light is bright but
still has enough saturation (slight color cast) to be distinguished from a
true specular hotspot, which washes out color entirely.

| Threshold | Value | Rationale |
|---|---|---|
| `brightnessThreshold` (Value) | 230 | Just below pure white (255); flags pixels close to fully blown-out. |
| `saturationThreshold` (Saturation) | 60 | Low enough that normal paper-white pixels (which retain a faint color tint from lighting) aren't misclassified, but catches true specular highlights, which are nearly colorless. |
| `noneCoveragePercent` | 1% | Below this, glare is imperceptible / does not affect any meaningful text region. |
| `minorCoveragePercent` | 5% | A small corner/edge hotspot; unlikely to obscure body text. |
| `moderateCoveragePercent` | 15% | A meaningful fraction of the page; likely overlaps some text lines. Coverage above 2x this (30%, derived in `scoring/glare.ts` as `moderateCoveragePercent * 2`) scores 0. |

These were validated with a synthetic unit test (a known 5%-area bright/
desaturated rectangle on an otherwise saturated background) to confirm the
HSV split correctly measures coverage, but the *severity bucket* cutoffs
themselves are heuristic and should be recalibrated against real glare
photos once available.

## Perspective (`PerspectiveThresholds`)

Computed purely from the four detected document corners (`computeEdgeMetrics`)
— no pixel data — as (a) the mean absolute deviation of each corner angle
from 90°, and (b) edge-length symmetry (how close opposing edges are in
length, which falls as perspective skew increases).

| Threshold | Value | Rationale |
|---|---|---|
| `excellentDeviationDegrees` | 2° | A document shot nearly straight-on from directly above naturally has a few degrees of corner-angle noise from contour detection itself; 2° is within that noise floor. |
| `poorDeviationDegrees` | 20° | Beyond this, the perspective warp is doing substantial work and text near the document's far edge is at risk of significant residual distortion/blur after correction. |
| `deviationWeight` | 0.6 | Corner-angle deviation is a more direct, less noisy signal of "how oblique was this shot" than edge symmetry (which can also be affected by the document not being a perfect rectangle), so it gets the majority weight; edge symmetry (1 − weight = 0.4) is a secondary corroborating signal. |

## Resolution (`ResolutionThresholds`)

Measured as the corrected (post-perspective-warp) document width in pixels
(`computeResolutionMetric`). Width, not height, is used as the single proxy
because document aspect ratio is roughly fixed (A4/A5-like) and OCR
engines/VLMs are generally sensitive to "pixels per character," which scales
with width for a fixed-aspect page.

| Threshold | Value | Rationale |
|---|---|---|
| `excellentWidthPx` | 2400 | For an A4-width page (~210mm), this is roughly 290 DPI-equivalent — comfortably above the ~150-200 DPI commonly recommended for reliable OCR of Latin text, with headroom for the finer strokes of kanji, which need more pixels per character than Latin glyphs to keep strokes distinguishable. |
| `goodWidthPx` | 1800 | ~215 DPI-equivalent for A4 width; still comfortably above general OCR guidance. |
| `acceptableWidthPx` | 1200 | ~145 DPI-equivalent for A4 width; near the low end of typical OCR DPI recommendations — workable for larger print, riskier for small kanji. |
| `poorWidthPx` | 800 | ~95 DPI-equivalent for A4 width; below common OCR DPI guidance, dense kanji text is likely to lose stroke detail. |

If a document type with a very different physical size or aspect ratio is
introduced (e.g., a small prescription slip vs. a full A4 referral letter),
these pixel thresholds should be recalibrated — they're tuned for "a
standard-sized printed page," not an absolute resolution requirement.

## Overall weights and grade (`QualityWeights`, `GradeThresholds`)

Weights (blur 40% / glare 30% / perspective 20% / resolution 10%) are taken
directly from the original feature request and reflect the request's stated
priority ordering: blur most directly destroys legibility; glare can
obscure entire regions; perspective skew is largely correctable by the
existing warp step (hence lower weight); resolution matters but a modestly
low-resolution sharp image is often still usable.

Grade cutoffs (excellent ≥90, good ≥75, acceptable ≥55, poor ≥35, else
unusable) are evenly-ish spaced bands intended to map roughly to: "ready to
process as-is," "process as-is, may have minor errors," "process but flag
for review," "likely needs recapture," "recapture required."

## Recommendations (`GuidanceConfig`)

`weakScoreThreshold` (70) is the score below which a metric is considered
weak enough to generate user guidance (`generateRecommendations`). It's set
below the "good" grade band (75) so that a document graded "good" overall
doesn't simultaneously surface guidance telling the user something is wrong.

## Recalibration procedure

Once real labeled outcomes exist (e.g., "did this image OCR successfully,
yes/no" or VLM extraction accuracy per image):

1. Log the raw metrics (`blurVariance`, `meanBrightness`, `glareCoveragePercent`,
   `cornerDeviation`/`edgeSymmetry`, corrected `width`) alongside the outcome
   for each processed image — all of these are returned directly in
   `DocumentQualityResult`, so this requires no extra instrumentation.
2. Plot raw metric vs. outcome to find the actual transition points between
   "reliably succeeds" and "reliably fails" for each metric independently.
3. Update the corresponding threshold values in `DEFAULT_QUALITY_CONFIG`
   (or pass a custom `QualityConfig` to `analyzeDocumentQuality()` without
   touching the defaults, if recalibrating per deployment/customer).
4. Re-run `npm test` — the unit tests assert relative/monotonic behavior
   (e.g. "higher variance scores higher") rather than hardcoding these exact
   threshold values everywhere, so most tests should remain valid after
   recalibration; tests that do assert exact default values will need
   updating alongside the config.
