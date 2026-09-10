import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnvironment } from '../server/environment.js';

const CLIENT_BUILD_DIRECTORY = fileURLToPath(new URL('../client/dist/', import.meta.url));
const SERVER_ONLY_ENVIRONMENT_VARIABLES = [
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'MAL_CLIENT_ID',
  'TMDB_ACCESS_TOKEN',
  'TMDB_IMAGE_BASE_URL',
  'THEGAMESDB_API_KEY',
  'RAWG_API_KEY'
];
const FORBIDDEN_CLIENT_PATTERNS = [
  { label: 'password hash field', pattern: /\b(?:password[_-]?hash|passwordHash)\b/i },
  { label: 'Session token field', pattern: /\b(?:session[_-]?token|token[_-]?hash|tokenHash)\b/i },
  { label: 'password hash format', pattern: /\bscrypt\$v\d+\$/i },
  { label: 'Session hash format', pattern: /\bsha256\$[a-f0-9]{64}\b/i },
  { label: 'Session token value', pattern: /\bgoraku_session=[A-Za-z0-9_-]{43}\b/i },
  { label: 'database connection URL', pattern: /\bpostgres(?:ql)?:\/\/[^\s"'`]+/i },
  { label: 'hard-coded credential value', pattern: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|database[_-]?url)\s*[:=]\s*["'`][^"'`\r\n]{8,}["'`]/i },
  { label: 'server diagnostic', pattern: /\b(?:diagnostic|stack trace|error\.stack)\b/i }
];

loadLocalEnvironment();

const configuredValues = SERVER_ONLY_ENVIRONMENT_VARIABLES
  .map((name) => ({ name, value: process.env[name]?.trim() ?? '' }))
  .filter(({ value }) => value);

async function buildFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await buildFiles(path));
    else files.push(path);
  }
  return files;
}

const files = await buildFiles(CLIENT_BUILD_DIRECTORY);
for (const file of files) {
  const contents = await readFile(file, 'utf8');
  const leakedIdentifier = SERVER_ONLY_ENVIRONMENT_VARIABLES.find((identifier) => contents.includes(identifier));
  if (leakedIdentifier) {
    throw new Error(`${leakedIdentifier} found in client build: ${file}`);
  }
  const leakedValue = configuredValues.find(({ value }) => contents.includes(value));
  if (leakedValue) {
    throw new Error(`${leakedValue.name} value found in client build: ${file}`);
  }
  const leakedPattern = FORBIDDEN_CLIENT_PATTERNS.find(({ pattern }) => pattern.test(contents));
  if (leakedPattern) {
    throw new Error(`${leakedPattern.label} found in client build: ${file}`);
  }
}

console.log(`Verified no server-only configuration identifiers or configured values in ${files.length} client build files.`);
