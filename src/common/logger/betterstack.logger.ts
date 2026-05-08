import { LoggerService, ConsoleLogger } from '@nestjs/common';
import { Logtail } from '@logtail/node';

export class BetterStackLogger extends ConsoleLogger implements LoggerService {
  private logtail: Logtail | null = null;

  constructor() {
    super();
    const token = process.env.BETTERSTACK_SOURCE_TOKEN;
    if (token) {
      try {
        this.logtail = new Logtail(token, {
          ignoreExceptions: true,
        });
        this.log('[BetterStackLogger] Initialized successfully. Streaming to Better Stack is active!');
      } catch (err: any) {
        console.error('[BetterStackLogger] Initialization failed:', err.message);
      }
    } else {
      this.warn('[BetterStackLogger] BETTERSTACK_SOURCE_TOKEN is not set. Running in local ConsoleLogger-only mode.');
    }
  }

  log(message: any, context?: string) {
    super.log(message, context);
    if (this.logtail) {
      this.logtail.info(message, { context });
    }
  }

  error(message: any, stack?: string, context?: string) {
    super.error(message, stack, context);
    if (this.logtail) {
      this.logtail.error(message, { stack, context });
    }
  }

  warn(message: any, context?: string) {
    super.warn(message, context);
    if (this.logtail) {
      this.logtail.warn(message, { context });
    }
  }

  debug(message: any, context?: string) {
    super.debug(message, context);
    if (this.logtail) {
      this.logtail.debug(message, { context });
    }
  }

  verbose(message: any, context?: string) {
    super.verbose(message, context);
    if (this.logtail) {
      this.logtail.info(message, { context, level: 'verbose' });
    }
  }
}
