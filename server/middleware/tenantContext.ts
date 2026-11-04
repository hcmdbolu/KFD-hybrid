import type { Request, Response, NextFunction } from 'express';
import { verifySessionToken } from '../../src/utils/security.ts';

export interface TenantRequest extends Request {
  user?: {
    valid: boolean;
    staffId?: string;
    role?: string;
    storeId?: string;
    permissions?: string[];
  };
  storeId: string;
}

/**
 * Multi-tenant JWT context extraction middleware.
 * Verifies bearer token, extracts tenant `store_id`, and sets `req.storeId`.
 */
export function tenantContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.headers['x-session-token'] as string);
  const headerStoreId = (req.headers['x-store-id'] as string) || (req.query.store_id as string);

  if (token) {
    const verified = verifySessionToken(token);
    if (verified.valid) {
      (req as TenantRequest).user = verified;
      (req as TenantRequest).storeId = verified.storeId || headerStoreId || 'store_default';
      return next();
    }
  }

  (req as TenantRequest).storeId = headerStoreId || 'store_default';
  next();
}

/**
 * Strict authentication guard for routes that require a verified session
 */
export function requireTenantAuth(req: Request, res: Response, next: NextFunction) {
  const tReq = req as TenantRequest;
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';

  if (tReq.user && tReq.user.valid) {
    return next();
  }

  // Allow local desktop app cashier client directly in offline-first mode
  if (isLocal && !process.env.DATABASE_URL) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Valid multi-tenant session token required',
  });
}

/**
 * Role-based permission guard
 */
export function requireTenantRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const tReq = req as TenantRequest;
    const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';

    if (isLocal && !tReq.user && !process.env.DATABASE_URL) {
      return next();
    }

    if (tReq.user?.role && allowedRoles.includes(tReq.user.role)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: `Forbidden: Requires ${allowedRoles.join(' or ')} permission for tenant ${tReq.storeId}`,
    });
  };
}

