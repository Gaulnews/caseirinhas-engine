export type StaffRole = 'owner' | 'operator' | 'viewer';

const ROLE_RANK: Record<StaffRole, number> = {
  viewer: 0,
  operator: 1,
  owner: 2,
};

export function isStaffRole(value: unknown): value is StaffRole {
  return value === 'owner' || value === 'operator' || value === 'viewer';
}

export function roleMeetsMinimum(role: StaffRole, minimum: StaffRole) {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
