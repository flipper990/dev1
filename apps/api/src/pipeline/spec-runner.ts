export async function runSpecRunner<T>(run: () => Promise<T>): Promise<T> {
  return run();
}

