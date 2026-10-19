import { availableParallelism, cpus, totalmem } from 'node:os';

/** Contexto descriptivo para comparar costes; nunca decide aceptación ni expone el entorno completo. */
export function executionEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const processors = cpus();
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    availableParallelism: availableParallelism(),
    logicalCpus: processors.length,
    cpuModels: [...new Set(processors.map((cpu) => cpu.model))],
    totalMemoryBytes: totalmem(),
    runnerImage: { os: env['ImageOS'] ?? null, version: env['ImageVersion'] ?? null },
  };
}
