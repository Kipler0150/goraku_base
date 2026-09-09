import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_BUILD_DIRECTORY = fileURLToPath(new URL('../client/dist/', import.meta.url));
const SECRET_ENVIRONMENT_VARIABLES = ['THEGAMESDB_API_KEY', 'RAWG_API_KEY'];
const secretValues = SECRET_ENVIRONMENT_VARIABLES
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
  const leakedIdentifier = SECRET_ENVIRONMENT_VARIABLES.find((identifier) => contents.includes(identifier));
  if (leakedIdentifier) {
    throw new Error(`${leakedIdentifier} found in client build: ${file}`);
  }
  const leakedValue = secretValues.find(({ value }) => contents.includes(value));
  if (leakedValue) {
    throw new Error(`${leakedValue.name} value found in client build: ${file}`);
  }
}

console.log(`Verified no server-only game credential identifiers or configured values in ${files.length} client build files.`);
