# Issue #111 New-Margin Size-Jitter Fix Design

## Context

GitHub issue #111 supplies two Gemini images with visible watermarks:

- `2752x1536`
- `2816x1536`

The current `v1.0.30` pipeline processes both images but selects `108x108 @ 192px` and `88x88 @ 192px` size-jitter candidates. The resulting images contain stronger green or orange diamond artifacts. Running the same repository alpha map at the exact `96x96 @ 192px` anchor removes both watermarks with only a faint bounded contour.

The catalog correctly assigns the `20260520` alpha variant to the new-margin anchor. Standard seed construction resolves that variant correctly. The size-jitter search later resolves each jittered size through the generic size resolver, which interpolates the default 96px alpha map instead of the seed's variant alpha map. Candidate provenance still retains `alphaVariant: '20260520'`, so diagnostics describe a variant-backed candidate even though its pixels came from the default profile.

## Goal

Make the automatic image pipeline select a safe `96x96 @ 192px` new-margin removal for both issue #111 samples while preserving legitimate size-jitter recovery on other images.

## Non-Goals

- Do not loosen global watermark-detection or damage thresholds.
- Do not add broad inpainting or denoising.
- Do not change preview, copy, download, worker, or video integration behavior.
- Do not disable size-jitter search for all official Gemini dimensions.
- Do not modify unrelated release artifacts already present in the worktree.

## Considered Approaches

### 1. Preserve only the variant alpha map during size jitter

Resize each seed's resolved alpha map instead of resolving a generic alpha map by size. This corrects the metadata/pixel mismatch but can still allow an incorrect 108px or 88px geometry to outrank a physically correct exact catalog anchor.

### 2. Preserve variant alpha and protect a validated exact catalog anchor

Resize the seed's resolved alpha map for variant-backed jitter candidates and prevent a weaker or damage-risky size-jitter candidate from replacing a validated exact `96x96 @ 192px` catalog candidate. This retains size-jitter recovery when it has materially stronger evidence while preventing issue #111's overfit geometries. This is the selected approach.

### 3. Disable size jitter for exact new-margin dimensions

This prevents the observed failure but also blocks legitimate render-scale drift for the same dimensions. It is unnecessarily broad.

## Design

### Variant-aware size-jitter alpha resolution

`searchStandardSizeJitterCandidate` will derive a jittered alpha map from the candidate seed:

1. If the target size matches the seed size, reuse `seed.alphaMap`.
2. If the seed has a resolved alpha map and the target size differs, interpolate `seed.alphaMap` from `seed.position.width` to the target size.
3. Fall back to the generic size resolver only when a seed alpha map is unavailable.

The jittered candidate config will preserve `seed.config.alphaVariant`. Provenance and the alpha pixels used for evaluation will therefore describe the same profile.

This behavior applies to every variant-backed seed, including current `20260520` and outline variants, without adding a profile-specific branch.

### Exact-anchor promotion guard

Candidate promotion will keep an accepted exact new-margin variant candidate when a size-jitter challenger has no materially stronger original watermark evidence or carries a damage warning. Size jitter remains eligible when the exact candidate is absent, rejected, or clearly inferior.

The guard is scoped by structured provenance and geometry:

- current candidate is an exact `96x96 @ 192px` seed with `alphaVariant: '20260520'`;
- challenger has `sizeJitter: true` and the same right/bottom margins;
- challenger must demonstrate a meaningful evidence advantage and remain damage-safe before it may replace the exact candidate.

Existing generic `pickBetterCandidate` ordering remains unchanged for non-variant anchors.

### Regression fixtures

Add two repository-owned issue #111 fixtures. Prefer lossless slim fixtures that retain:

- original full dimensions;
- the original bottom-right 512px region;
- all pixels used by the 64px and 192px anchor candidates and their jitter ranges.

The unused image area may be replaced with a compressible background only if the slim fixture reproduces the pre-fix 108px and 88px selections. If slimming changes candidate selection, use losslessly optimized full originals.

Record the source issue URL and source SHA-256 values in the test or fixture metadata:

- `2752x1536`: `a9f6e892eec881339568a93b8a1770d42afd8afdf2ac5ef1409c26d91e20a04d`
- `2816x1536`: `7cf8be3fac455866884250ba158498d0dc6dc3c130fd511427260783a2090b41`

### Regression assertions

The issue #111 regression must first fail on `v1.0.30` and then assert:

- processing is applied;
- final config is `logoSize: 96`, `marginRight: 192`, `marginBottom: 192`;
- final position matches the full image dimensions;
- selected provenance does not report size jitter;
- selected alpha profile is `20260520`;
- located-aggressive cleanup is not accepted merely to compensate for the wrong geometry;
- the final bottom-right ROI stays within a bounded pixel difference from a direct `20260520` `96x96 @ 192px` reference removal;
- output quality is not `possible-content-damage` or `mixed`.

A focused unit test will separately prove that jittering a variant-backed seed interpolates that seed's alpha map rather than the default alpha map.

## Files

- Modify `src/core/candidateSelector.js`
  - add variant-aware seed alpha interpolation for size jitter;
  - add the narrowly scoped exact-anchor promotion rule.
- Modify `tests/core/candidateSelector.test.js`
  - add the focused variant-backed size-jitter alpha test.
- Modify `tests/core/watermarkProcessor.test.js`
  - add end-to-end issue #111 assertions.
- Add issue #111 fixtures under `tests/fixtures/`.

No public API or type declaration changes are required.

## Test Flow

1. Add the issue fixtures and regression tests.
2. Run the focused tests and confirm they fail because the pipeline selects 108px/88px or uses the wrong alpha profile.
3. Implement seed-based alpha interpolation.
4. Re-run focused tests.
5. Add the exact-anchor promotion guard and re-run.
6. Run candidate selector, watermark processor, sample regression, and full image release validation suites.
7. Generate before/current/fixed bottom-right crop evidence and confirm both outputs no longer contain colored diamond artifacts.

## Acceptance Criteria

- Both issue #111 samples automatically use `96x96 @ 192px`.
- The removal pixels use the `20260520` alpha profile.
- No colored diamond residual is visible in the fixed comparison crops.
- Existing size-jitter recovery tests remain green.
- Existing canonical 96px/64px and issue #68 new-margin tests remain green.
- Automated quality classification does not report a pass for an output that the issue-specific visual gate marks as damaged.
- No unrelated tracked files are changed.

## Risks and Mitigations

- **Risk:** exact-anchor preference could suppress legitimate size drift.
  - **Mitigation:** require structured variant/new-margin provenance and allow jitter replacement on materially stronger, damage-safe evidence.
- **Risk:** compact fixtures could alter local statistics.
  - **Mitigation:** verify the compact fixtures reproduce the pre-fix selections before using them.
- **Risk:** a metric-only assertion could repeat the current false pass.
  - **Mitigation:** compare the output ROI against the direct physical-reference removal and retain a rendered crop artifact for review.
