import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_BUILD_DIRECTORY = fileURLToPath(new URL('../client/dist/', import.meta.url));
const SECRET_IDENTIFIERS = ['THEGAMESDB_API_KEY', 'RAWG_API_KEY'];

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
  const leakedIdentifier = SECRET_IDENTIFIERS.find((identifier) => contents.includes(identifier));
  if (leakedIdentifier) {
    throw new Error(`${leakedIdentifier} found in client build: ${file}`);
  }
}

console.log(`Verified no server-only game credentials in ${files.length} client build files.`);
