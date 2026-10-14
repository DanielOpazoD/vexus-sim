# Renal and psoas surface regularization

The 1.5 mm source lattice left visible stair steps on both renal capsules and
psoas. Averaging triangle normals alone did not remove them. The derived atlas
now regularizes fields 5, 6 and 9 before reconstructing renal/psoas clearance.
The ultrasound classifier and the 3D extractor consume the same revised fields.

`tools/anatomy/reconstruct-renal-bed.py --input <original-atlas.gzip.bin>` requires
the hash-pinned original atlas recorded in the manifest, never its own output.
It applies a separable Gaussian (sigma 1 voxel, radius 3), offsets the zero level
to preserve occupied-centre volume, limits the field change to 1.5 mm, and fades
the regularization between source distances 4 and 8 mm. Derived samples use
1/64 mm quantization. Then the existing 2 mm field clearance is reconstructed.
Run `tools/anatomy/build-abdominal-surface.ts` afterward to regenerate organ,
fat and fascia surfaces. Other organ fields and all label channels are unchanged.

This is bounded removal of lattice artifacts, not a new anatomical segmentation.
The estimated 2 mm clearance and 0.3 mm fascial layer retain their calibration
limitations. The field after regularization is an implicit contour, not an exact
Euclidean distance everywhere. Do not interpret its changes as patient measurements.

Coincident atlas vertices now share triangle indices. Three.js can therefore
recompute smooth, area-weighted normals during breathing without reverting to
independent flat triangle normals. This does not move vertices or add grooves.

Local validation on 2026-10-14:

- Renal occupied-centre volume changes: right −0.019%, left −0.042%; each remains
  one connected component. Psoas retains two components and 97.51% of original
  volume after the previously established clearance reconstruction.
- 22 focused tests pass: envelope separation and sequence, shared 3D/acoustic
  fields, atlas constraints, and respiratory geometry/normal restoration.
- Four native Metal browser tests pass in normal and severe-congestion cases,
  including CPU/GPU fascia classification, interface normals and probe controls.
- Matched 65-frame continuous sweeps in renal and hepatorenal windows before and
  after: no page/WebGL errors; mean adjacent-frame grayscale differences remain
  similar (renal 1.544 → 1.540; hepatorenal 1.524 → 1.522, 0–255 scale).
- Typecheck/build, fixed asset budgets and lint pass. This is local evidence,
  not remote CI, clinical validation, or a performance benchmark.
