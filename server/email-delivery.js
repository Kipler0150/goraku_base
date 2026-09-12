const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const DEFAULT_APP_ORIGIN = 'http://localhost:5173';
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export class EmailDeliveryError extends Error {
  constructor(message, code = 'EMAIL_DELIVERY_UNAVAILABLE') {
    super(message);
    this.name = 'EmailDeliveryError';
    this.code = code;
  }
}

function resolveMode(mode, environment = process.env) {
  const requestedMode = typeof mode === 'string' && mode.trim()
    ? mode
    : environment.EMAIL_DELIVERY_MODE;
  const configured = typeof requestedMode === 'string' && requestedMode.trim()
    ? requestedMode.trim().toLowerCase()
    : null;
  if (configured && !['console', 'brevo'].includes(configured)) {
    throw new TypeError('EMAIL_DELIVERY_MODE must be console or brevo.');
  }
  if (configured) return configured;
  // Local development remains usable when Brevo is not configured or its key
  // has not yet been activated. Production must opt into the real provider.
  return environment.NODE_ENV === 'production' ? 'brevo' : 'console';
}

function linkFor(appOrigin, path, token) {
  const url = new URL(path, appOrigin);
  url.searchParams.set('token', token);
  return url.toString();
}

function messageText(kind, username, link, expiresIn) {
  const greeting = username ? `Hi ${username},` : 'Hi,';
  if (kind === 'verification') {
    return `${greeting}\n\nVerify your Goraku Base email address by opening this link:\n${link}\n\nThis link expires in ${expiresIn}.`;
  }
  return `${greeting}\n\nReset your Goraku Base password by opening this link:\n${link}\n\nThis link expires in ${expiresIn}. If you did not request this, you can ignore this email.`;
}

async function sendBrevo({ apiKey, senderEmail, senderName, to, subject, text, fetchImplementation }) {
  if (!apiKey || !senderEmail || !senderName) {
    throw new EmailDeliveryError('Brevo email delivery is not configured.');
  }

  let response;
  try {
    response = await fetchImplementation(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to }],
        subject,
        textContent: text
      })
    });
  } catch {
    throw new EmailDeliveryError('The email provider could not be reached.');
  }

  if (!response.ok) {
    throw new EmailDeliveryError('The email provider rejected the message.');
  }
}

/**
 * Create the server-side email transport. Raw API keys never leave this
 * module and console mode prints only the one-time link for local testing.
 */
export function createEmailDelivery({
  mode,
  apiKey = process.env.BREVO_API_KEY,
  senderEmail = process.env.BREVO_SENDER_EMAIL,
  senderName = process.env.BREVO_SENDER_NAME,
  appOrigin = process.env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN,
  fetchImplementation = fetch,
  logger = console,
  environment = process.env
} = {}) {
  const resolvedMode = resolveMode(mode, environment);
  const origin = new URL(appOrigin).origin;
  const send = async ({ to, username, kind, token }) => {
    const isVerification = kind === 'verification';
    const link = linkFor(origin, isVerification ? '/api/auth/verify-email' : '/api/auth/reset-password', token);
    const subject = isVerification ? 'Verify your Goraku Base email' : 'Reset your Goraku Base password';
    const text = messageText(isVerification ? 'verification' : 'reset', username, link, isVerification ? '24 hours' : '1 hour');

    if (resolvedMode === 'console') {
      logger.info(`[Goraku Base] ${subject} for ${to}: ${link}`);
      return;
    }

    await sendBrevo({ apiKey, senderEmail, senderName, to, subject, text, fetchImplementation });
  };

  return {
    mode: resolvedMode,
    verificationTokenTtlMs: VERIFICATION_TOKEN_TTL_MS,
    passwordResetTokenTtlMs: PASSWORD_RESET_TOKEN_TTL_MS,
    sendVerificationEmail: (details) => send({ ...details, kind: 'verification' }),
    sendPasswordResetEmail: (details) => send({ ...details, kind: 'reset' })
  };
}

export const emailDeliveryEndpoint = BREVO_ENDPOINT;
