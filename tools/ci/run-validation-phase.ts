/** Mismo ejecutor por fase en CI y en el lote local; el veredicto conserva la reconciliación original. */
import { assertValidationPhase } from './validationEvidence';
import { executeValidationPhase } from './validationPhase';
import { runLocalValidation } from './localValidation';
const phase = process.argv[2];
if (phase === 'all') await runLocalValidation();
else {
  assertValidationPhase(phase);
  await executeValidationPhase(phase);
}
