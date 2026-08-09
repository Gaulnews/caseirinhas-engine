import { describe, expect, it } from 'vitest';
import { isStaffRole, roleMeetsMinimum } from '../src/lib/server/roles';

describe('roleMeetsMinimum', () => {
  it('owner meets every threshold', () => {
    expect(roleMeetsMinimum('owner', 'viewer')).toBe(true);
    expect(roleMeetsMinimum('owner', 'operator')).toBe(true);
    expect(roleMeetsMinimum('owner', 'owner')).toBe(true);
  });

  it('operator meets viewer and operator, but not owner', () => {
    expect(roleMeetsMinimum('operator', 'viewer')).toBe(true);
    expect(roleMeetsMinimum('operator', 'operator')).toBe(true);
    expect(roleMeetsMinimum('operator', 'owner')).toBe(false);
  });

  it('viewer only meets viewer', () => {
    expect(roleMeetsMinimum('viewer', 'viewer')).toBe(true);
    expect(roleMeetsMinimum('viewer', 'operator')).toBe(false);
    expect(roleMeetsMinimum('viewer', 'owner')).toBe(false);
  });
});

describe('isStaffRole', () => {
  it('accepts the three known roles', () => {
    expect(isStaffRole('owner')).toBe(true);
    expect(isStaffRole('operator')).toBe(true);
    expect(isStaffRole('viewer')).toBe(true);
  });

  it('rejects anything else, including case variants and null-ish values', () => {
    expect(isStaffRole('admin')).toBe(false);
    expect(isStaffRole('Owner')).toBe(false);
    expect(isStaffRole('')).toBe(false);
    expect(isStaffRole(null)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});
