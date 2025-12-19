import type { AuthAdapter, BaseUser } from '../core/types.js';

export type { AuthAdapter, BaseUser };

export function defineAuthAdapter<TUser extends BaseUser = BaseUser>(
  adapter: AuthAdapter<TUser>
): AuthAdapter<TUser> {
  return adapter;
}
