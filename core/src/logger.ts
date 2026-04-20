type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  data?: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  (process.env['LOG_LEVEL'] as LogLevel | undefined) ??
  (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatEntry(entry: LogEntry): string {
  if (process.env['NODE_ENV'] === 'production') {
    return JSON.stringify(entry);
  }

  const ctx = entry.context ? `[${entry.context}] ` : '';
  const data = entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : '';
  return `${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} ${ctx}${entry.message}${data}`;
}

function write(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;
  const formatted = formatEntry(entry);
  if (entry.level === 'error' || entry.level === 'warn') {
    process.stderr.write(formatted + '\n');
  } else {
    process.stdout.write(formatted + '\n');
  }
}

function createEntry(
  level: LogLevel,
  message: string,
  context?: string,
  data?: unknown,
): LogEntry {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  if (context !== undefined) entry.context = context;
  if (data !== undefined) entry.data = data;
  return entry;
}

export class Logger {
  constructor(private readonly context: string) {}

  debug(message: string, data?: unknown): void {
    write(createEntry('debug', message, this.context, data));
  }

  info(message: string, data?: unknown): void {
    write(createEntry('info', message, this.context, data));
  }

  warn(message: string, data?: unknown): void {
    write(createEntry('warn', message, this.context, data));
  }

  error(message: string, data?: unknown): void {
    write(createEntry('error', message, this.context, data));
  }

  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`);
  }
}

export const rootLogger = new Logger('root');
