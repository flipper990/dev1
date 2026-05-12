export async function runQaLoopRunner<T>(run: () => Promise<T>): Promise<T> {
  return run();
}

