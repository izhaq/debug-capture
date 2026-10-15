/**
 * The compiler options from a tsconfig file that change how esbuild emits
 * code, so the test, build and size bundles compile the way `tsc` does.
 */
import ts from 'typescript';

const EMIT_OPTIONS = ['experimentalDecorators', 'useDefineForClassFields', 'emitDecoratorMetadata'];

/** @param {string} file absolute path to a tsconfig*.json */
export function readCompilerOptions(file) {
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  const options = config.compilerOptions ?? {};
  return Object.fromEntries(EMIT_OPTIONS.filter((k) => k in options).map((k) => [k, options[k]]));
}
