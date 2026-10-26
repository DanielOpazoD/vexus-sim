import type { VexusContext } from '../vexus/classification';
import type { CaseId } from './index';

/**
 * Lo que solo ve el docente de cada caso (decisión 82): los confusores reales (`context`, las casillas que el alumno
 * debería marcar en «Medir») y por qué el caso engaña (`trap`; `null` en los casos de referencia). Fuera del
 * `PatientState` y de la viñeta: este módulo solo lo importa `app/teacherNotes.ts`, que solo importa la pestaña Docente,
 * cargada en su propio chunk en modo docente, así que el JS que descarga el alumno no lleva ni las trampas ni los
 * confusores reales (`codeSplitting.test.ts`; el nombre del caso y su `PatientState` sí van en él: `blind-mode-screen-only`). `cases.test.ts` exige la coherencia con la fisiología (la FA con el ritmo, la ventilación
 * con el modo, la presión intraabdominal ≥ 12 mmHg y la cirrosis con la resistencia intrahepática).
 */
export interface CaseTeaching {
  context: VexusContext;
  trap: string | null;
}

export const CASE_TEACHING: Readonly<Record<CaseId, CaseTeaching>> = {
  'normal-adult': { context: {}, trap: null },
  'severe-congestion': { context: {}, trap: null },
  'af-moderate-congestion': { context: { atrialFibrillation: true }, trap: null },
  'abdominal-hypertension': {
    context: { raisedIntraAbdominalPressure: true },
    trap:
      'VCI comprimida: el cálculo literal de grado 0 no cierra la interpretación. La presión intraabdominal, por encima de la PAD, comprime la VCI abdominal (≈ 14–16 mm y ' +
      'colapsable) con la PAD media en 13–14 mmHg. La suprahepática no encaja con esa VCI: drena a la aurícula por encima ' +
      'del abdomen, la PIA no la toca y conserva la S invertida de la IT funcional con la PAD alta (sin la IT sería ' +
      'S < D). Una S invertida sola no prueba la congestión (la IT la da también sin ella): lo que impide concluir grado 0 ' +
      'es esa discordancia con la viñeta (presión vesical 16, oliguria, VD disfuncionante). Con «Presión ' +
      'intraabdominal alta» marcada, una VCI < 20 mm ya no cierra el grado en 0: el resultado da el intervalo (0–2 con ' +
      'las tres venas medidas). La porta sale normal o en el límite (≈ 25–31 %) y el riñón continuo: en el simulador la ' +
      'PIA amortigua las ondas que les llegan de la aurícula; en la clínica, además, comprime la vena renal y el riñón, y ' +
      'eso el simulador no lo hace.',
  },
  'tricuspid-regurgitation': {
    context: {},
    trap:
      'VExUS 2 con discordancia entre territorios. La IT invierte la S hepática con PAD media de 7–8 mmHg en este modelo. ' +
      'La VCI mide ≈ 24–25 mm, la porta es leve (≈ 33–40 %) y el riñón continuo. La PAD media no describe por sí sola ' +
      'la exposición venosa pulsátil: no superar un corte de una cohorte no demuestra ausencia de congestión. ' +
      'Conserva el hallazgo hepático y relaciónalo con las otras venas y la clínica (sin edemas, peso estable). ' +
      'El grado no demuestra lesión renal ni prescribe tratamiento.',
  },
  'mechanical-ventilation': {
    context: { positivePressureVentilation: true },
    trap:
      'Grado 1: VCI dilatada sin patrones orgánicos graves en la referencia de este escenario. La presión positiva ' +
      'modifica la presión pleural, la PAD y la VCI; no permite descartar congestión ni inferir volemia por sí sola. ' +
      'La VCI mide ≈ 23 mm en pausa espiratoria y 23–26 mm durante ventilación. Documenta las condiciones respiratorias ' +
      'y compara adquisiciones compatibles. En pausa espiratoria los tres Doppler de referencia son normales. ' +
      'Con el ventilador ciclando, la adquisición hepática puede ser no medible o producir una inversión espuria ' +
      '(limitación del simulador); revisa señal, ECG y calidad antes de interpretar.',
  },
  'cirrhosis-pulmonary-hypertension': {
    context: { cirrhosis: true },
    trap:
      'La porta subestima. La resistencia intrahepática (gradiente portal ≈ 15 mmHg) amortigua la pulsatilidad que llega ' +
      'a la porta: PF ≈ 32–35 % (leve; en apnea el alumno mide ≈ 34–42 %) con la PAD media en 17–18 mmHg, cuando el mismo ' +
      'corazón sin cirrosis da 69–76 %. La suprahepática (S invertida) y el riñón (monofásico) siguen graves: no concluir ' +
      'con la porta sola. Con «Cirrosis» marcada, la porta deja de contar, pero la S invertida sí (la cirrosis aplana la ' +
      'suprahepática, no la invierte) y el grado sigue en 3. En el cirrótico la suprahepática también puede salir plana: ' +
      'el simulador no lo modela.',
  },
};
