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
  NOTIFICATION_TOAST_DURATION, filterNotificationToasts, collectNewOperationalToasts,
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

test('burst shows at most two, then promotes pending in arrival order', () => {
  assert.equal(MAX_VISIBLE_NOTIFICATION_TOASTS, 2);
  assert.equal(NOTIFICATION_TOAST_DURATION, 6000);
  const items = Array.from({ length: 5 }, (_, index) => notification(String(index)));
  const first = enqueueNotificationToasts({ visible: [], pending: [] }, items);
  assert.deepEqual(first.visible.map(item => item.id), ['0', '1']);
  assert.deepEqual(first.pending.map(item => item.id), ['2', '3', '4']);
  const next = dismissNotificationToast(first, '1');
  assert.deepEqual(next.visible.map(item => item.id), ['0', '2']);
  assert.deepEqual(next.pending.map(item => item.id), ['3', '4']);
});

test('queue deduplicates exact event ids but retains distinct events with equal text', () => {
  const first = notification('first');
  const second = notification('second');
  const queue = enqueueNotificationToasts({ visible: [], pending: [] }, [first, first, second]);
  assert.deepEqual(queue.visible.map(item => item.id), ['first', 'second']);
  const repeated = enqueueNotificationToasts(queue, [first, second, notification('third')]);
  assert.deepEqual(repeated.visible.map(item => item.id), ['first', 'second']);
  assert.deepEqual(repeated.pending.map(item => item.id), ['third']);
  assert.deepEqual(dismissNotificationToast(repeated, 'first').visible.map(item => item.id), ['second', 'third']);
});

test('acting CSR cancellation remains a popup with its shipment context and reason', () => {
  const cancelled = notification('assignment-ASN123-cancelled', {
    statusUpdate: 'cancelled', driverName: 'CSR@360logistics.ph',
    message: '[ATV 2313] Delivery cancelled · Customer requested a different date',
  });
  const result = collectNewOperationalToasts([cancelled], new Set(), true);
  assert.deepEqual(result.toasts, [cancelled]);
  assert.equal(result.toasts[0].truckPlate, 'ATV 2313');
  assert.match(result.toasts[0].message, /Customer requested a different date/);
  const action = { id: 'feedback-1', type: 'feedback', message: 'Assignment cancelled successfully.', tone: 'success' };
  const stack = enqueueNotificationToasts({ visible: [], pending: [] }, [action, ...result.toasts]);
  assert.deepEqual(stack.visible.map(item => item.id), ['feedback-1', cancelled.id]);
});

test('disabling operational popups keeps local action feedback and promotes the queue', () => {
  const action = { id: 'feedback-1', type: 'feedback', message: 'Saved', tone: 'success' };
  const queue = enqueueNotificationToasts({ visible: [], pending: [] }, [notification('one'), action, notification('two')]);
  const filtered = filterNotificationToasts(queue, item => item.type === 'feedback');
  assert.deepEqual(filtered.visible.map(item => item.id), ['feedback-1']);
  assert.deepEqual(filtered.pending, []);
});

test('polling does not replay a seen event or a read-state change', () => {
  const first = notification('first');
  const seeded = new Set(['historical']);
  const update = collectNewOperationalToasts([notification('historical'), first], seeded, true);
  assert.deepEqual(update.toasts.map(item => item.id), ['first']);
  const repeated = collectNewOperationalToasts([notification('historical'), { ...first, read: true }], update.knownIds, true);
  assert.deepEqual(repeated.toasts, []);
  const distinct = collectNewOperationalToasts([first, notification('second')], repeated.knownIds, true);
  assert.deepEqual(distinct.toasts.map(item => item.id), ['second']);
});

test('a new account seeds its own history and does not inherit an old popup queue', () => {
  const previousAccountQueue = enqueueNotificationToasts({ visible: [], pending: [] }, [notification('old-account')]);
  assert.equal(previousAccountQueue.visible.length, 1);
  const newAccountHistory = [notification('new-account-history')];
  const seededKnownIds = new Set(newAccountHistory.map(item => item.id));
  const update = collectNewOperationalToasts(newAccountHistory, seededKnownIds, true);
  assert.deepEqual(update.toasts, []);
  const newEvent = collectNewOperationalToasts([...newAccountHistory, notification('new-event')], update.knownIds, true);
  assert.deepEqual(newEvent.toasts.map(item => item.id), ['new-event']);
});
