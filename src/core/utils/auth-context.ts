import type { AuthRequestContext } from '../types.js';
import { parseCookies } from './cookies.js';

export function buildAuthContext(req: Request): AuthRequestContext {
  return {
    headers: req.headers,
    cookies: parseCookies(req.headers.get('cookie')),
  };
}
