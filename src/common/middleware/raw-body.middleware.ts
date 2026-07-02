import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * @deprecated Raw-body capture is now handled centrally in `main.ts` via
 * `express.json({ verify })`, which records the exact raw bytes on
 * `req.rawBody` for the webhook paths (/payments/webhook, /webhooks/daily,
 * /webhooks/zoom) DURING normal JSON parsing.
 *
 * The previous implementation read the request stream itself
 * (`req.on('data' | 'end')`). When the global `app.use(json())` parser ran on
 * the same request it drained the stream first, so the `data`/`end` events here
 * never fired with content — leaving `req.rawBody` empty and breaking every
 * signed webhook (signatures computed over an empty / re-serialized body never
 * match the provider HMAC).
 *
 * This class is intentionally now a no-op passthrough and is no longer wired
 * into any route. Do NOT re-register it for the webhook paths: reading the
 * stream a second time would double-consume the request body.
 */
@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) {
    next();
  }
}
