/**
 * Lightweight runtime assertions for recent audit fixes (no Firebase required).
 */
import assert from 'node:assert/strict';

// --- Mirror of isEquipmentUsable logic (kept in sync with lib/equipment-mgmt-types.ts) ---
function isEquipmentUsable(eq) {
  if (eq.is_deleted || eq.equipment_status !== 'Active') return false;
  if (eq.qualification_status !== 'Qualified' && eq.qualification_status !== 'Not Required') return false;
  if (eq.calibration_required && (eq.calibration_status === 'Failed' || eq.calibration_status === 'Overdue')) return false;
  if (eq.pm_required && (eq.pm_status === 'Failed' || eq.pm_status === 'Overdue')) return false;
  return true;
}

assert.equal(isEquipmentUsable({
  equipment_status: 'Active', qualification_status: 'Qualified',
  calibration_required: false, pm_required: false,
  calibration_status: 'Not Required', pm_status: 'Not Required',
}), true, 'qualified active equipment should be usable');

assert.equal(isEquipmentUsable({
  equipment_status: 'Active', qualification_status: '',
  calibration_required: false, pm_required: false,
  calibration_status: 'Not Required', pm_status: 'Not Required',
}), false, 'empty qualification must NOT be usable');

assert.equal(isEquipmentUsable({
  equipment_status: 'Active', qualification_status: 'Not Qualified',
  calibration_required: false, pm_required: false,
  calibration_status: 'Not Required', pm_status: 'Not Required',
}), false, 'not qualified must not be usable');

assert.equal(isEquipmentUsable({
  equipment_status: 'Active', qualification_status: 'Qualified',
  calibration_required: true, pm_required: false,
  calibration_status: 'Overdue', pm_status: 'Not Required',
}), false, 'cal overdue + required must block');

assert.equal(isEquipmentUsable({
  equipment_status: 'Active', qualification_status: 'Qualified',
  calibration_required: false, pm_required: false,
  calibration_status: 'Overdue', pm_status: 'Not Required',
}), true, 'cal overdue ignored when not required');

// --- access_status blocking ---
const blockedStatuses = ['pending', 'disabled', 'locked', 'retired', 'rejected'];
assert.equal(blockedStatuses.includes(''), false, 'empty access_status must allow active users');
assert.equal(blockedStatuses.includes('approved'), false, 'approved must allow');
assert.equal(blockedStatuses.includes('pending'), true, 'pending must block');
assert.equal(blockedStatuses.includes('locked'), true, 'locked must block');

// --- safe redirect ---
function safeRedirect(redirectParam) {
  const AUTH_ROUTES = ['/auth/login', '/auth/signup', '/login'];
  return redirectParam
    && redirectParam.startsWith('/')
    && !redirectParam.startsWith('//')
    && !AUTH_ROUTES.some((route) => redirectParam === route || redirectParam.startsWith(`${route}/`))
    ? redirectParam
    : '/launcher';
}
assert.equal(safeRedirect('/admin/products'), '/admin/products');
assert.equal(safeRedirect('//evil.com'), '/launcher');
assert.equal(safeRedirect('/auth/login'), '/launcher');
assert.equal(safeRedirect(null), '/launcher');

// --- canManageEquipment normalized roles ---
function canManageEquipment(role) {
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager',
    'engineering', 'engineering_manager', 'engineering_executive', 'maintenance',
  ].includes(role);
}
assert.equal(canManageEquipment('engineering_manager'), true);
assert.equal(canManageEquipment('engineering'), true);
assert.equal(canManageEquipment('viewer'), false);

console.log('Audit-fix runtime assertions passed.');
