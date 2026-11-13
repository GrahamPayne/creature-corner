import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implementsNotificationProviderContract } from '../../../src/features/shop/notifications/notificationProvider.js';
import { noopNotificationProvider } from '../../../src/features/shop/notifications/noopNotificationProvider.js';

test('noopNotificationProvider implements the NotificationProvider contract', () => {
  assert.equal(implementsNotificationProviderContract(noopNotificationProvider), true);
});

test('noopNotificationProvider always reports sent: false — it genuinely never sends anything', async () => {
  const result = await noopNotificationProvider.notify({ type: 'order.paid', order: { id: 'order-1', orderNumber: 'CC-20261113-0001' }, recipient: 'customer@example.com' });
  assert.deepEqual(result, { sent: false });
});
