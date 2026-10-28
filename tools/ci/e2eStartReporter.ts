import { relative } from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** Identifica el intento en curso aunque el proceso no alcance a escribir el informe final. */
export default class E2eStartReporter implements Reporter {
  private rootDir = '';

  onBegin(config: FullConfig): void {
    this.rootDir = config.rootDir;
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    const entry = {
      sourceSha: process.env.E2E_SOURCE_SHA ?? null,
      testId: test.id,
      file: relative(this.rootDir, test.location.file).replaceAll('\\', '/'),
      line: test.location.line,
      title: test.titlePath(),
      retry: result.retry,
      workerIndex: result.workerIndex,
    };
    // Una línea por intento, sin cuadros, pasos ni resultados inferidos.
    process.stdout.write(`[e2e:begin] ${JSON.stringify(entry)}\n`);
  }

  printsToStdio(): boolean {
    return true;
  }
}
