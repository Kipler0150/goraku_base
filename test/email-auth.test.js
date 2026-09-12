import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmailDelivery, EmailDeliveryError } from '../server/email-delivery.js';
import { isDisposableEmailDomain } from '../server/disposable-email-domains.js';

describe('verified-email authentication support', () => {
  it('blocks common and configured disposable email domains without blocking ordinary providers', () => {
    assert.equal(isDisposableEmailDomain('reader@mailinator.com'), true);
    assert.equal(isDisposableEmailDomain('reader@sub.mailinator.com'), true);
    assert.equal(isDisposableEmailDomain('reader@company.example'), false);
    assert.equal(isDisposableEmailDomain('reader@throwaway.example', { DISPOSABLE_EMAIL_DOMAINS: 'throwaway.example' }), true);
  });

  it('prints a local verification link through the console transport', async () => {
    const messages = [];
    const delivery = createEmailDelivery({
      mode: 'console',
      appOrigin: 'http://localhost:5173',
      logger: { info: (message) => messages.push(message) }
    });

    await delivery.sendVerificationEmail({ to: 'reader@example.com', username: 'reader', token: 'verification-token' });

    assert.equal(messages.length, 1);
    assert.match(messages[0], /reader@example\.com/);
    assert.match(messages[0], /http:\/\/localhost:5173\/api\/auth\/verify-email\?token=verification-token/);
  });

  it('sends a Brevo API request without exposing the API key in the message', async () => {
    let request;
    const delivery = createEmailDelivery({
      mode: 'brevo',
      apiKey: 'secret-api-key',
      senderEmail: 'verified@example.com',
      senderName: 'Goraku Base',
      fetchImplementation: async (url, options) => {
        request = { url, options };
        return { ok: true, status: 201 };
      }
    });

    await delivery.sendPasswordResetEmail({ to: 'reader@example.com', username: 'reader', token: 'reset-token' });

    assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(request.options.headers['api-key'], 'secret-api-key');
    assert.match(request.options.body, /Reset your Goraku Base password/);
    assert.doesNotMatch(request.options.body, /secret-api-key/);
  });

  it('maps Brevo rejection to a safe provider error', async () => {
    const delivery = createEmailDelivery({
      mode: 'brevo',
      apiKey: 'secret-api-key',
      senderEmail: 'verified@example.com',
      senderName: 'Goraku Base',
      fetchImplementation: async () => ({ ok: false, status: 401 })
    });

    await assert.rejects(
      () => delivery.sendVerificationEmail({ to: 'reader@example.com', token: 'verification-token' }),
      (error) => error instanceof EmailDeliveryError && error.code === 'EMAIL_DELIVERY_UNAVAILABLE'
    );
  });
});
