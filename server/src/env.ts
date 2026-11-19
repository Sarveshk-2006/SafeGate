import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let hasInitialized = false;
let loadedSources: string[] = [];

/**
 * Resolves the directory of this module across both CommonJS (tests) and ESM (production/dev runtime).
 */
function resolveModuleDir(): string {
  try {
    if (typeof __dirname !== 'undefined') {
      return __dirname;
    }
  } catch {
    // __dirname is undefined in native ESM
  }

  try {
    const getImportMetaUrl = new Function('return import.meta.url');
    const metaUrl = getImportMetaUrl();
    if (metaUrl) {
      return path.dirname(fileURLToPath(metaUrl));
    }
  } catch {
    // Fallback if dynamic import.meta evaluation fails
  }

  return process.cwd();
}

/**
 * Deterministically loads environment variables from candidate .env locations.
 * 
 * Precedence Order (highest to lowest):
 * 1. Pre-existing environment variables (deployment / shell / container environment)
 * 2. Custom path specified via process.env.DOTENV_CONFIG_PATH
 * 3. Server directory .env (server/.env)
 * 4. Repository root directory .env (.env)
 * 5. Current working directory .env (process.cwd()/.env)
 * 
 * Lower precedence sources will NEVER overwrite variables already set by higher precedence sources.
 */
export function loadEnvironment(options?: {
  customPath?: string;
  forceReload?: boolean;
}): { loaded: boolean; sources: string[] } {
  if (hasInitialized && !options?.forceReload) {
    return { loaded: loadedSources.length > 0, sources: [...loadedSources] };
  }

  const sources: string[] = [];
  const candidatePaths: string[] = [];

  // 1. Custom path override if specified
  const customPath = options?.customPath || process.env.DOTENV_CONFIG_PATH;
  if (customPath) {
    candidatePaths.push(path.resolve(customPath));
  }

  // 2. Resolve anchored to this file's physical location on disk
  try {
    const moduleDir = resolveModuleDir();
    // If moduleDir ends in 'server/src' or 'server/dist'
    const serverDir = path.basename(moduleDir) === 'src' || path.basename(moduleDir) === 'dist'
      ? path.resolve(moduleDir, '..')
      : path.resolve(moduleDir, 'server');
    const rootDir = path.resolve(serverDir, '..');

    // server/.env
    candidatePaths.push(path.join(serverDir, '.env'));
    // root .env
    candidatePaths.push(path.join(rootDir, '.env'));
  } catch {
    // Continue with remaining candidates
  }

  // 3. Fallback to process.cwd()/.env
  candidatePaths.push(path.join(process.cwd(), '.env'));
  candidatePaths.push(path.join(process.cwd(), 'server', '.env'));

  // Deduplicate candidate paths while preserving precedence order
  const uniquePaths = Array.from(new Set(candidatePaths));

  for (const envPath of uniquePaths) {
    try {
      if (fs.existsSync(envPath) && fs.statSync(envPath).isFile()) {
        // dotenv.config() does not overwrite existing process.env variables by default
        const result = dotenv.config({ path: envPath });
        if (!result.error) {
          sources.push(envPath);
        }
      }
    } catch {
      // Silently continue checking remaining candidate paths
    }
  }

  hasInitialized = true;
  loadedSources = sources;

  return { loaded: sources.length > 0, sources };
}

// Automatically load environment on initial module import
loadEnvironment();
