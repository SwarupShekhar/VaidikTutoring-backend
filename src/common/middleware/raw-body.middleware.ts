import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Only apply to webhook endpoint
    if (req.path === '/payments/webhook' || req.path === '/webhooks/daily') {
      req.setEncoding('utf8');
      let rawData = '';
      
      req.on('data', (chunk) => {
        rawData += chunk;
      });
      
      req.on('end', () => {
        (req as any).rawBody = rawData;
        // Parse JSON for normal processing
        try {
          req.body = JSON.parse(rawData);
        } catch (error) {
          req.body = {};
        }
        next();
      });
    } else {
      next();
    }
  }
}
