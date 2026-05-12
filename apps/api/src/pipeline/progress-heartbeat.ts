export async function runWithProgressHeartbeat<T>(run: () => Promise<T>): Promise<T> {
  return run();
}

