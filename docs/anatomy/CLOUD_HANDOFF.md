# Cloud handoff — reference torso WIP, 2026-10-01

**Incomplete draft; do not merge/deploy.** User requested migration from the Mac; no further local implementation or heavy testing is authorized during setup.

Estado vigente y alcance completo: [TORSO_PROGRESS.md](TORSO_PROGRESS.md); referencia opt-in `?reference=1`.

Base: #130 / branch `feat/costal-registration`, commit2128d82c924b5491788e1e429b4854d6a21ae135. Work branch `feat/reference-torso`. Original PR119/120 and prior125–130 untouched.

## Preserved implementation

BodyParts3D-derived skin field (8×65 Float32,2080bytes), reflected LPS→LAS and anchored to distal xiphoid; fixed vertebral offset; shared six costal pairs5–10, source curve fits and observed anterior bone endpoints. CPU/GLSL/contact/3D/cut-map worker share the field. Loader is transactional and the composition root moved to bootstrap.ts without logic loss. Root coverage exclusion follows the same browser-only composition code; thresholds unchanged. Historical WIP state (superseded by cloud fixes): the application loaded reference geometry by default; `?torso=legacy` is an explicit comparison fixture. Two existing legacy costal tests use that explicit fixture; new source-field tests cover mesh/reflection/parity/acquisition.

Preset recalibration is offline against fixed model landmarks, actual contact and unblocked bone/lung rays; no organ or rib was displaced to recover windows. Start points are selected by scene's torso profile. Subxiphoid, flank and renal captures now recover useful vessels/renal anatomy. The ray report explains the regression at old UI poses: source subxiphoid plane offset25–27mm vs old1–3mm; renal offset~38mm. Old values are not the same world trajectory after changing skin.

## Checks actually completed

- Typecheck and lint passed before the latest small loader-test/documentation additions; rerun before push/cloud work.
- Latest focal suite17/17 passed (reference field/loader/mesh/normals, registration, legacy cards/navigator).
- Three true IQ/spectral acquisition tests passed with normal patient: hepatic/portal/renal, actual contact/transmission/protocol identity and quality.issue=null. That run preceded the final portal preset phi3.3,z−55; rerun the chain on current state.
- Chrome on the Mac with Metal: reference+legacy comparison2/2 passed; latest seven-window tissue CPU/GPU agreement1.0, all now contain blood interior. Full50k-volume/shell gate proceeded to a **real unresolved failure**: `Perichondrium` samples0, required>50. No thresholds relaxed.
- Portal coverage initially47, then50; final anatomy-centred candidate with more angular margin passed the existing>50 gate. The current failure is perichondrial absence, not portal coverage.
- Full coverage/check/calibration/full E2E/remote CI have not passed on this WIP.

## Next concrete defect

Reference bone fits are clipped at observed bone endpoints and deliberately did not invent cartilage. Thus the new torso has **no functional source costal cartilage/perichondrium**, and the existing anatomical gate detects that. Preserve the red result. Inspect source cartilages and fit/register them coherently in CPU/GPU/3D rather than broadening the old bone ellipse or removing the gate. FJ3345/FJ3255 (seventh cartilage) were downloaded but not integrated; inspect components/labels because right7 spans positiveX as well. Source part tables and original OBJ are in the migration archive. Complete other pairs/cartilage only with measured source provenance. No claim of24 functional ribs.

Other remaining work: full source extraction/segmentation reproducibility (current generator deterministically reproduces binary from inspectable intermediate); quantify curve surface residuals, contacts diaphragm/liver/kidney and IVC→RA; paired controlled performance; left shadow/normals on the new field, not just legacy; calibration and all gates. Retain explicit missing/interpolated skin-ray masks and external-validation limits.

## Reproduction after selecting a connected cloud environment

```sh
# Fetch this work branch if published; otherwise checkout base then apply checkpoint.patch and copy new-files.
npm ci
python3 tools/anatomy/reference-body.py
npm run typecheck
npm run lint
npm test -- --run src/validation/referenceBody.test.ts src/validation/costalGeometry.test.ts src/validation/registration.test.ts
VITEST_TIER=slow npm test -- --run src/validation/referenceAcquisition.test.ts
npm run build
npm run e2e -- e2e/referenceAdult.spec.ts e2e/equivalence.spec.ts --workers=1
# Existing config uses SwiftShader. Do not increase timeouts or lower physical/quality/flaky gates.
# After defect correction, sequentially:
npm run check
npm run calibrate
npm run e2e -- --workers=1
```

`tools/anatomy/reference-ray-report.ts` gives unchanged-UI geometry; `find-reference-poses.ts [territory]` performs offline landmark/ray search; `reference-containment.ts` samples baseline tissue versus new skin. No hidden anatomy is used by learner measurement. The old extraction scripts in the archive retain Mac absolute paths: adapt their root/mesh arguments before replaying; do not treat them as a completed production pipeline.

## Costs and evidence

Last measured productionJS about1014.7KiB, within the approved total1016KiB =1,040,384bytes. Recompute exact bytes after any edit. Per-chunk limits and production/test-only counting unchanged; bootstrap is the same335KiB application-root budget. Binary2080bytes (gzip1890), texture allocation unchanged24,576bytes, one-time worker clone2080bytes. No new totalJS increase authorized. M4 microbenchmark~22ms/12-render average is uncontrolled host evidence, not a30fps clinical/performance guarantee.

Library preserves earlier regression comparisons: before libfile_47ed66897d1c8191a3a6a3df6aaa7e46, after libfile_46e3b6742e74819180e8fb372793e262; obstructed flank libfile_da1d288073548191a532e6eef92bc558 and renal libfile_5e005a740f8c81919484a153f1c12b14. Migration archive also includes the recovered captures and logs. Those images reflect different presets after recalibration, not identical world rays.

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International. Source release4; no clinical/human approval and no patient data included. Atlas is one adult male reference, not population dimensions.
