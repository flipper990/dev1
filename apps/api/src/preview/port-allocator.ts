// ─────────────────────────────────────────────────────────────
// Port allocator — tracks reserved ports for preview containers
// so we never publish two containers to the same host port.
// ─────────────────────────────────────────────────────────────

import { createServer } from 'node:net';

/**
 * Ask the OS for a free TCP port that is not already reserved
 * by another caller of this allocator. The port is reserved
 * until release(port) is called.
 */
export class PortAllocator {
  private reserved = new Set<number>();
  private readonly minPort: number;
  private readonly maxPort: number;

  constructor(minPort = 1_024, maxPort = 65_535) {
    this.minPort = minPort;
    this.maxPort = maxPort;
  }

  async allocate(): Promise<number> {
    // The OS already guarantees the port is free at the moment listen(0) returns.
    // We only re-roll if the port is one we've already reserved (active container)
    // or falls outside the unprivileged range.
    for (let i = 0; i < 50; i++) {
      const port = await this.askOSForFreePort();
      if (port < this.minPort || port > this.maxPort) continue;
      if (this.reserved.has(port)) continue;
      this.reserved.add(port);
      return port;
    }
    throw new Error('PortAllocator: unable to find a free port after 50 attempts');
  }

  release(port: number): void {
    this.reserved.delete(port);
  }

  private askOSForFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer();
      srv.unref();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        srv.close(() => {
          if (addr && typeof addr === 'object') {
            resolve(addr.port);
          } else {
            reject(new Error('PortAllocator: invalid server address'));
          }
        });
      });
    });
  }
}
