import type { CacheAdapter } from '../core/types.js';

export type { CacheAdapter };

export function defineCacheAdapter(adapter: CacheAdapter): CacheAdapter {
  return adapter;
}
