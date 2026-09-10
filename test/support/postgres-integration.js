import assert from 'node:assert/strict';
import { runMigrations } from '../../server/db/migrate.js';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const SENSITIVE_RESPONSE_PATTERN = /\b(?:password[_-]?hash|passwordHash|token[_-]?hash|tokenHash|scrypt\$v\d+\$|sha256\$[a-f0-9]{64}|postgres(?:ql)?:\/\/|diagnostic|stack trace|error\.stack|goraku_dev)\b/i;

export function assertDedicatedTestDatabase(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required to run PostgreSQL integration tests.');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL for a dedicated test database.');
  }
  if (databaseName !== 'goraku_test') {
    throw new Error('TEST_DATABASE_URL must point to the dedicated goraku_test database.');
  }
}

export function quoteSchemaIdentifier(schema) {
  return `"${schema}"`;
}

export function createSchemaPool(pool, schema) {
  const quotedSchema = quoteSchemaIdentifier(schema);

  return {
    async connect() {
      const client = await pool.connect();
      await client.query(`SET search_path TO ${quotedSchema}, public`);
      return client;
    },
    async query(text, values) {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${quotedSchema}, public`);
        return await client.query(text, values);
      } finally {
        client.release();
      }
    }
  };
}

export async function createMigratedSchema(pool, prefix) {
  const schemaName = `${prefix}_${process.pid}_${Date.now()}`;
  await pool.query(`CREATE SCHEMA ${quoteSchemaIdentifier(schemaName)}`);
  await runMigrations({ pool, schema: schemaName });
  return { schemaName, schemaPool: createSchemaPool(pool, schemaName) };
}

export function dropTestSchema(pool, schema) {
  return pool.query(`DROP SCHEMA ${quoteSchemaIdentifier(schema)} CASCADE`);
}

export function sessionCookieValue(response) {
  const cookie = response.headers['set-cookie']?.find((value) => value.startsWith('goraku_session='));
  assert.ok(cookie, 'expected a goraku_session cookie');
  return cookie.split(';', 1)[0];
}

export function assertSafeResponse(response) {
  const serializedResponse = `${response.text ?? ''}\n${JSON.stringify(response.body ?? '')}`;
  assert.doesNotMatch(serializedResponse, SENSITIVE_RESPONSE_PATTERN);
}
