import type { LoggerAdapter, AuditEvent, BaseUser } from '../core/types.js';

export type { LoggerAdapter, AuditEvent };

export function defineLoggerAdapter<TUser extends BaseUser = BaseUser>(
  adapter: LoggerAdapter<TUser>
): LoggerAdapter<TUser> {
  return adapter;
}
