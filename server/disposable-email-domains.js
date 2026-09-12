// This intentionally small baseline catches common throwaway providers. The
// environment variable can extend it without requiring a code deployment.
const COMMON_DISPOSABLE_DOMAINS = Object.freeze([
  '10minutemail.com',
  'disposablemail.com',
  'dispostable.com',
  'emailondeck.com',
  'getnada.com',
  'guerrillamail.com',
  'maildrop.cc',
  'mailinator.com',
  'sharklasers.com',
  'temp-mail.org',
  'tempmail.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com'
]);

function normalizedDomain(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/^\.+|\.+$/g, '') : '';
}

function configuredDomains(environment = process.env) {
  const configured = typeof environment.DISPOSABLE_EMAIL_DOMAINS === 'string'
    ? environment.DISPOSABLE_EMAIL_DOMAINS.split(',')
    : [];
  return new Set([...COMMON_DISPOSABLE_DOMAINS, ...configured].map(normalizedDomain).filter(Boolean));
}

export function emailDomain(email) {
  if (typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  return normalizedDomain(email.slice(at + 1));
}

export function isDisposableEmailDomain(email, environment = process.env) {
  const domain = emailDomain(email);
  if (!domain) return false;
  const domains = configuredDomains(environment);
  return domains.has(domain) || [...domains].some((candidate) => domain.endsWith(`.${candidate}`));
}

export const commonDisposableEmailDomains = COMMON_DISPOSABLE_DOMAINS;
