/** Deterministic starting conditions for the physical and display wall suites. */
import { AnatomyQuery } from '../../anatomy/query';
import { AnatomyScene } from '../../anatomy/scene';
import { NORMAL_ADULT } from '../../cases';
import { PhysiologyEngine } from '../../physiology/engine';
import { clonePatient } from '../../physiology/patientState';
import { nominalTgcDbPerCm } from '../../ultrasound/renderer';
import { B_MHZ } from './wallTwin';
export const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
export const scene = new AnatomyScene(patient);
export const anatomy = new AnatomyQuery(scene);
export const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 4 });
for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
export const caliber = anatomy.caliberFor(engine.sample);
export const t = scene.torso;
export const WALL_MM = t.skinMm + t.fatMm + t.muscleMm;
export const TGC = nominalTgcDbPerCm(B_MHZ);
/** 1,5× en amplitud. */
export const RATIO_15_DB = 20 * Math.log10(1.5);
/**
 * Sin textura (con las caras), septos y estrías no pueden pasar de esto sobre su capa (dB): lo que quede es
 * la falda de los ecos de las fascias. Con las muestras a < `WALL_INTERIOR_MM` de una cara, el gemelo daba
 * 2,1–2,8 dB de «septos» y 0,3–4,7 dB de «estrías» sin textura alguna.
 */
export const SKIRT_DB = 1.5;
