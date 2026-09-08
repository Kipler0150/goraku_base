import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_LOCAL_ENV_FILE = fileURLToPath(new URL('../.env.local', import.meta.url));

/**
 * Load optional local server configuration while preserving values supplied by the shell.
 *
 * @param {string} [filePath]
 */
export function loadLocalEnvironment(filePath = DEFAULT_LOCAL_ENV_FILE) {
  try {
    loadEnvFile(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
