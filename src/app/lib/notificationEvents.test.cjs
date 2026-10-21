const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

const file = join(__dirname, 'notificationEvents.ts');
const source = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleForTest = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleForTest, moduleForTest.exports);
const {
  MILESTONE_NOTIFICATIONS, isActivityKey, isToastEligible, notificationDestination,
  enqueueNotificationToasts, dismissNotificationToast, MAX_VISIBLE_NOTIFICATION_TOASTS,
  NOTIFICATION_TOAST_DURATION,
} = moduleForTest.exports;

const notification = (id, overrides = {}) => ({
  id, type: 'status_update', assignmentId: 'ASN123', truckPlate: 'ATV 2313',
  message: 'Loading completed', statusUpdate: 'loading_completed', read: false,
  ...overrides,
});

test('only meaningful workflow transitions have milestone events', () => {
  assert.deepEqual(Object.keys(MILESTONE_NOTIFICATIONS), [
    'arrive_pickup', 'finish_loading', 'depart', 'arrive_destination', 'finish_unloading', 'delivered',
  ]);
  assert.equal(isActivityKey('loading_completed'), true);
  assert.equal(isActivityKey('cancelled'), true);
  assert.equal(isActivityKey('start_loading'), false);
  assert.equal(isActivityKey('pickup_front'), false);
});

test('only persisted operational action items qualify for popups', () => {
  assert.equal(isToastEligible(notification('milestone')), true);
  assert.equal(isToastEligible(notification('photo', { statusUpdate: 'pickup_front' })), false);
  assert.equal(isToastEligible(notification('started', { statusUpdate: 'start_loading' })), false);
  assert.equal(isToastEligible(notification('ordinary-doc', { type: 'doc_upload', message: 'Sales Invoice uploaded' })), false);
  assert.equal(isToastEligible(notification('review', { type: 'doc_upload', message: 'Documents ready for review · 6 documents uploaded' })), true);
  assert.equal(isToastEligible(notification('corrected', { type: 'doc_upload', message: 'Corrected Sales Invoice uploaded' })), true);
  assert.equal(isToastEligible(notification('', { id: '' })), false);
});

test('popup and bell use the same shipment and review destination', () => {
  assert.deepEqual(notificationDestination(notification('milestone')), {
    page: 'Monitor', target: { assignmentId: 'ASN123', docType: undefined, review: false, activityKey: 'loading_completed' },
    actionLabel: 'View Activity',
  });
  const review = notificationDestination(notification('doc', { type: 'doc_upload', docType: 'Sales Invoice' }));
  assert.equal(review.page, 'Monitor');
  assert.equal(review.target.review, true);
  assert.equal(review.target.docType, 'Sales Invoice');
  assert.equal(review.actionLabel, 'Review');
});

test('burst shows at most three, then promotes pending in arrival order', () => {
  assert.equal(MAX_VISIBLE_NOTIFICATION_TOASTS, 3);
  assert.equal(NOTIFICATION_TOAST_DURATION, 6000);
  const items = Array.from({ length: 5 }, (_, index) => notification(String(index)));
  const first = enqueueNotificationToasts({ visible: [], pending: [] }, items);
  assert.deepEqual(first.visible.map(item => item.id), ['0', '1', '2']);
  assert.deepEqual(first.pending.map(item => item.id), ['3', '4']);
  const next = dismissNotificationToast(first, '1');
  assert.deepEqual(next.visible.map(item => item.id), ['0', '2', '3']);
  assert.deepEqual(next.pending.map(item => item.id), ['4']);
});
