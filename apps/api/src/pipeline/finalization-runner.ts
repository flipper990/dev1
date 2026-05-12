export async function runFinalizationRunner<T>(run: () => Promise<T>): Promise<T> {
  return run();
}

