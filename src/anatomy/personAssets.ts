import { validateReferenceBody } from './referenceBody';
import type { SourceVolume } from './sourceVolume';

export interface PersonIdentity {
  readonly person: 'current' | 'legacy' | 's0028';
  readonly frameId: string;
  readonly revision: string;
  readonly manifestSha256: string;
  readonly schemaVersion: 1;
}

export interface AtlasLayout {
  readonly textureDimensions: readonly [number, number, number];
  readonly rawBytes: number;
  readonly sha256Raw: string;
}

export interface PersonAssetDescriptor {
  readonly identity: PersonIdentity;
  readonly abdominal?: AtlasLayout;
  readonly thoracic?: AtlasLayout;
  readonly fields: readonly (SourceVolume | undefined)[];
  readonly thoracicField?: SourceVolume;
  readonly labelModulus?: number;
  readonly dome?: boolean;
  readonly thoracicMaterials?: readonly number[];
  readonly capacityBytes?: number;
  readonly skinBytes?: number;
}

/** Propiedad del contexto. La copia estructurada al Worker nunca transfiere estos buffers. */
export interface PersonBuffers {
  readonly abdominal?: Uint16Array;
  readonly thoracic?: Uint16Array;
  readonly body?: Float32Array;
  readonly reference?: Float32Array;
  readonly capacity?: ArrayBuffer;
  readonly skin?: ArrayBuffer;
}

export interface PersonAssets {
  readonly identity: PersonIdentity;
  readonly assetKey: string;
  readonly descriptor: PersonAssetDescriptor;
  readonly buffers: Readonly<PersonBuffers>;
}

/** No congela elementos de typed arrays; congela la estructura que conserva su propiedad. */
export function freezeDescriptor<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !ArrayBuffer.isView(child) && !(child instanceof ArrayBuffer)) freezeDescriptor(child);
  }
  return Object.freeze(value);
}

export function personAssetKey(descriptor: PersonAssetDescriptor): string {
  const { identity: i, abdominal, thoracic, capacityBytes, skinBytes } = descriptor;
  return [
    i.person,
    i.frameId,
    i.revision,
    i.schemaVersion,
    i.manifestSha256,
    abdominal?.sha256Raw ?? '',
    thoracic?.sha256Raw ?? '',
    capacityBytes ?? 0,
    skinBytes ?? 0,
  ].join(':');
}

/** Construcción local: cualquier fallo deja intactos todos los contextos ya instalados. */
export function installPersonAssets(descriptor: PersonAssetDescriptor, buffers: PersonBuffers): PersonAssets {
  for (const name of ['abdominal', 'thoracic'] as const) {
    const layout = descriptor[name];
    const values = buffers[name];
    if (
      !!layout !== !!values ||
      (layout &&
        values &&
        (!(values instanceof Uint16Array) ||
          layout.textureDimensions.length !== 3 ||
          layout.textureDimensions.some((d) => !Number.isSafeInteger(d) || d <= 0) ||
          values.byteLength !== layout.rawBytes ||
          layout.textureDimensions.reduce((a, b) => a * b, 1) * 4 !== layout.rawBytes))
    )
      throw new Error(`Activo ${name} incompatible con ${descriptor.identity.person}`);
  }
  for (const [name, bytes] of [
    ['capacity', descriptor.capacityBytes],
    ['skin', descriptor.skinBytes],
  ] as const) {
    if ((buffers[name] && !(buffers[name] instanceof ArrayBuffer)) || (buffers[name]?.byteLength ?? 0) !== (bytes ?? 0))
      throw new Error(`Activo ${name} incompatible con ${descriptor.identity.person}`);
  }
  for (const profile of [buffers.body, buffers.reference])
    if (profile) {
      if (!(profile instanceof Float32Array)) throw new Error('Perfil incompatible');
      validateReferenceBody(profile);
    }
  return Object.freeze({
    identity: descriptor.identity,
    assetKey: personAssetKey(descriptor) + (buffers.reference ? ':reference' : ':body'),
    descriptor: freezeDescriptor(descriptor),
    buffers: Object.freeze({ ...buffers }),
  });
}
