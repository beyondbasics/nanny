export class Logger {
  info(message: string): void {
    console.log(`[nanny] ${message}`);
  }

  warn(message: string): void {
    console.warn(`[nanny] ${message}`);
  }

  error(message: string): void {
    console.error(`[nanny] ${message}`);
  }
}
