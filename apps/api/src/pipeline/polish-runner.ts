export async function runPolishRunner<T>(run: () => Promise<T>): Promise<T> {
  return run();
}

