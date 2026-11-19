import * as fs from 'fs';
import * as path from 'path';

// Firebase credentials / Firestore export or Emulator credentials
const PG_CONFIG = {
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE || 'aarizo_community',
  user: process.env.PG_USER || 'aarizo_admin',
  password: process.env.PG_PASSWORD || 'aarizo_secure_password_2026',
};

export function isExplicitLocalDevOrTestEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (
    env.CI === 'true' ||
    env.CI === '1' ||
    Boolean(env.VERCEL) ||
    Boolean(env.RENDER) ||
    Boolean(env.RAILWAY_ENVIRONMENT) ||
    Boolean(env.FLY_APP_NAME) ||
    Boolean(env.HEROKU_APP_NAME) ||
    Boolean(env.KUBERNETES_SERVICE_HOST) ||
    Boolean(env.AWS_EXECUTION_ENV)
  ) {
    return false;
  }

  const nodeEnv = (env.NODE_ENV || '').toLowerCase().trim();
  return nodeEnv === 'development' || nodeEnv === 'dev' || nodeEnv === 'test' || nodeEnv === 'local';
}

export function isProductionOrNonDevEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isExplicitLocalDevOrTestEnv(env);
}

export function determineMigrationFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const baseFiles = ['01_schema.sql', '02_rls_policies.sql'];
  const isLocalDev = isExplicitLocalDevOrTestEnv(env);
  const applyDemoSeed = (env.APPLY_DEMO_SEED || '').toLowerCase().trim() === 'true';

  // Strict fail-closed policy: If not an explicitly authorized local dev/test environment,
  // 03_seed.sql is ALWAYS excluded. APPLY_DEMO_SEED is rejected in non-dev environments.
  if (!isLocalDev) {
    if (applyDemoSeed) {
      console.warn('⚠️ [SECURITY] APPLY_DEMO_SEED rejected: Demo credentials and personas cannot be applied outside authorized local development.');
    }
    console.log('🔒 Production or non-development environment detected. Excluding demo 03_seed.sql from migration.');
    return baseFiles;
  }

  return [...baseFiles, '03_seed.sql'];
}

export async function runPostgresMigration() {
  console.log('Connecting to PostgreSQL database...');
  let ClientClass: any;
  try {
    const pg = await import('pg');
    ClientClass = pg.Client || (pg.default && (pg.default as any).Client);
  } catch (err) {
    console.error('The "pg" package is required to execute runPostgresMigration. Please install pg: npm install pg');
    throw err;
  }
  const client = new ClientClass(PG_CONFIG);

  try {
    await client.connect();
    console.log(' Connected to PostgreSQL successfully!');

    const sqlDir = path.resolve(__dirname);
    const files = determineMigrationFiles();

    // If local demo seed is included, authorize the connection for the PL/pgSQL guard
    if (files.includes('03_seed.sql')) {
      await client.query("SET aarizo.environment = 'development';");
    }

    for (const file of files) {
      const filePath = path.join(sqlDir, file);
      if (fs.existsSync(filePath)) {
        console.log(` Executing ${file}...`);
        const sql = fs.readFileSync(filePath, 'utf-8');
        await client.query(sql);
        console.log(` Successfully executed ${file}`);
      }
    }

    // Verify row counts
    const res = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM societies) as societies_count,
        (SELECT COUNT(*) FROM towers) as towers_count,
        (SELECT COUNT(*) FROM flats) as flats_count,
        (SELECT COUNT(*) FROM users) as users_count,
        (SELECT COUNT(*) FROM residents) as residents_count,
        (SELECT COUNT(*) FROM visitor_passes) as passes_count,
        (SELECT COUNT(*) FROM billing_invoices) as invoices_count;
    `);

    console.log('\n--- PostgreSQL Verification Summary ---');
    console.table(res.rows);
    console.log('--- Migration Completed Successfully ---');
  } catch (error) {
    console.error(' Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Auto-run if executed directly
if (require.main === module) {
  runPostgresMigration();
}
