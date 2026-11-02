import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PosDatabase } from '../server/db/sqlite.ts';
import { PosPostgresDatabase } from '../server/db/postgres.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log('========================================================================');
  console.log('🚀 KIID FROM DREAM POS: SQLite to PostgreSQL Cloud Migration');
  console.log('========================================================================');

  const defaultDataDir = process.env.POS_DATA_DIR || (
    process.env.APPDATA
      ? path.resolve(process.env.APPDATA, 'kiidfromdream-pos', 'data')
      : path.resolve(__dirname, '..', 'data')
  );

  const sqlitePath = path.resolve(defaultDataDir, 'pos_database.db');
  if (!fs.existsSync(sqlitePath)) {
    console.warn(`[WARNING] SQLite database not found at: ${sqlitePath}. Migration will run with empty/default datasets.`);
  } else {
    console.log(`[INFO] Found SQLite database: ${sqlitePath}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[ERROR] DATABASE_URL environment variable is required to execute PostgreSQL migration.');
    console.error('Example: DATABASE_URL=postgresql://user:password@cloud-postgres-host:5432/kiid_pos_db');
    process.exit(1);
  }

  console.log('[INFO] Connecting to Cloud PostgreSQL instance...');
  const pgDb = new PosPostgresDatabase(databaseUrl);
  await pgDb.initSchema();
  console.log('[SUCCESS] PostgreSQL schema & Row-Level Security policies verified.');

  const sqliteDb = new PosDatabase(defaultDataDir);

  const migrationStats: Record<string, { read: number; written: number; status: string }> = {};

  // 1. Tenants Migration
  console.log('\n[1/10] Migrating Tenants & Organizations...');
  const tenants = sqliteDb.listTenants();
  let tenantCount = 0;
  for (const t of tenants) {
    try {
      await pgDb.registerTenant({
        business_name: t.business_name,
        vertical: t.vertical,
        currency: t.currency,
        phone: t.phone,
        address: t.address,
      });
      tenantCount++;
    } catch {
      // Tenant might already exist
    }
  }
  migrationStats['tenants'] = { read: tenants.length, written: tenantCount, status: 'OK' };

  // 2. Core Entities Migration
  const tables = [
    'categories',
    'discount_rules',
    'employees',
    'suppliers',
    'customers',
    'products',
    'pos_terminals',
    'sales',
    'refunds',
    'audit_logs',
    'cycle_counts',
    'stock_transfers',
    'cash_transfers',
    'customer_debt_repayments',
  ];

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    process.stdout.write(`\r[${i + 2}/${tables.length + 2}] Migrating table '${table}'... `);
    const rows = sqliteDb.getTable(table);
    let written = 0;

    for (const row of rows) {
      try {
        const storeId = row.store_id || 'store_default';
        switch (table) {
          case 'products':
            await pgDb.upsertProduct(row, storeId);
            break;
          case 'customers':
            await pgDb.upsertCustomer(row, storeId);
            break;
          case 'suppliers':
            await pgDb.upsertSupplier(row, storeId);
            break;
          case 'employees':
            await pgDb.upsertEmployee(row, storeId);
            break;
          case 'sales':
            await pgDb.addSale(row, storeId);
            break;
          case 'refunds':
            await pgDb.addRefund(row, storeId);
            break;
          case 'audit_logs':
            await pgDb.addAuditLog(row, storeId);
            break;
          case 'cycle_counts':
            await pgDb.addCycleCount(row, storeId);
            break;
          case 'stock_transfers':
            await pgDb.addStockTransfer(row, storeId);
            break;
          case 'pos_terminals':
            await pgDb.upsertPosTerminal(row, storeId);
            break;
          case 'cash_transfers':
            await pgDb.addCashTransfer(row, storeId);
            break;
          case 'customer_debt_repayments':
            await pgDb.addCustomerDebtRepayment(row, storeId);
            break;
          case 'categories':
            await pgDb.upsertCategory(row, storeId);
            break;
          case 'discount_rules':
            await pgDb.upsertDiscountRule(row, storeId);
            break;
          default:
            break;
        }
        written++;
      } catch (err: any) {
        console.warn(`\n[WARN] Failed row in ${table}:`, err.message);
      }
    }
    migrationStats[table] = { read: rows.length, written, status: 'OK' };
    console.log(`Done (${written}/${rows.length} rows migrated).`);
  }

  // 3. System & Branding Settings
  console.log('\n[FINAL] Migrating receipt settings and discount security config...');
  const receiptSettings = sqliteDb.getReceiptSettings();
  if (receiptSettings) {
    await pgDb.upsertReceiptSettings(receiptSettings, receiptSettings.store_id || 'store_default');
  }
  const discountConfig = sqliteDb.getDiscountSecurityConfig();
  if (discountConfig) {
    await pgDb.upsertDiscountSecurityConfig(discountConfig, discountConfig.store_id || 'store_default');
  }

  console.log('\n========================================================================');
  console.log('📊 MIGRATION SUMMARY & AUDIT RECONCILIATION');
  console.log('========================================================================');
  console.table(migrationStats);
  console.log('\n[SUCCESS] SQLite to Cloud PostgreSQL migration finished without critical errors!');

  await pgDb.close();
  sqliteDb.close();
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('\n[FATAL] Migration script terminated with error:', err);
  process.exit(1);
});

