import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IPosDatabase, DatabaseMetadata } from './adapter.ts';
import { DEFAULT_RECEIPT_CONFIG, DEFAULT_DISCOUNT_SECURITY_CONFIG, DEFAULT_CATEGORIES, DEFAULT_MANAGEMENT_DISCOUNT_RULES } from './sqlite.ts';
import { hashPin } from '../../src/utils/security.ts';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PosPostgresDatabase implements IPosDatabase {
  private pool: pg.Pool;
  private isInitialized = false;

  constructor(connectionString?: string) {
    const connStr = connectionString || process.env.DATABASE_URL;
    if (!connStr) {
      console.warn('[POSTGRES] No DATABASE_URL provided. Initializing connection pool from standard PG environment variables...');
    }

    this.pool = new Pool({
      connectionString: connStr,
      ssl: process.env.PGSSLMODE === 'disable' || !process.env.PGSSLMODE && (!connStr || connStr.includes('localhost') || connStr.includes('127.0.0.1'))
        ? false
        : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      console.error('[POSTGRES POOL ERROR] Unexpected client error:', err);
    });
  }

  /**
   * Initializes PostgreSQL schema and RLS policies from schema.sql
   */
  public async initSchema(): Promise<void> {
    if (this.isInitialized) return;
    try {
      const schemaPath = path.resolve(__dirname, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        console.log('[POSTGRES] Applying multi-tenant schema with Row-Level Security...');
        const sql = fs.readFileSync(schemaPath, 'utf-8');
        await this.pool.query(sql);
        console.log('[POSTGRES] Schema, GIN indexes, and RLS policies initialized successfully.');
      }
      this.isInitialized = true;
    } catch (err: any) {
      console.error('[POSTGRES] Schema initialization error:', err.message);
      throw err;
    }
  }

  /**
   * Executes a database operation within a leased connection pre-configured
   * with the tenant's Row-Level Security store_id session variable.
   */
  public async withTenant<T>(storeId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      const effectiveStoreId = storeId || 'store_default';
      await client.query("SELECT set_config('app.current_store_id', $1, true)", [effectiveStoreId]);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /**
   * Executes a database transaction scoped to a tenant
   */
  public async transaction<T>(storeId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      const effectiveStoreId = storeId || 'store_default';
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_store_id', $1, true)", [effectiveStoreId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async getMetadata(): Promise<DatabaseMetadata> {
    try {
      const res = await this.pool.query("SELECT value FROM metadata WHERE key = 'db_info'");
      if (res.rows.length > 0) {
        const val = typeof res.rows[0].value === 'string' ? JSON.parse(res.rows[0].value) : res.rows[0].value;
        return {
          version: Number(val.version) || 1,
          lastUpdated: val.lastUpdated || new Date().toISOString(),
        };
      }
    } catch {}
    return { version: 1, lastUpdated: new Date().toISOString() };
  }

  public async touchVersion(): Promise<number> {
    const now = new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query("SELECT value FROM metadata WHERE key = 'db_info' FOR UPDATE");
      let currentVersion = 1;
      if (res.rows.length > 0) {
        const val = typeof res.rows[0].value === 'string' ? JSON.parse(res.rows[0].value) : res.rows[0].value;
        currentVersion = Number(val.version) || 1;
      }
      const newVersion = currentVersion + 1;
      const newMeta = { version: newVersion, lastUpdated: now };
      await client.query(
        "INSERT INTO metadata (key, value, updated_at) VALUES ('db_info', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = NOW()",
        [JSON.stringify(newMeta)]
      );
      await client.query('COMMIT');
      return newVersion;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async getTable(table: string, storeId: string = 'store_default'): Promise<any[]> {
    return this.withTenant(storeId, async (client) => {
      const safeTable = table.replace(/[^a-z0-9_]/gi, '');
      const res = await client.query(`SELECT data FROM ${safeTable} WHERE store_id = $1 ORDER BY created_at DESC`, [storeId]);
      return res.rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
    });
  }

  public async getById<T = any>(table: string, idField: string, idVal: any, storeId: string = 'store_default'): Promise<T | null> {
    return this.withTenant(storeId, async (client) => {
      const safeTable = table.replace(/[^a-z0-9_]/gi, '');
      const safeField = idField.replace(/[^a-z0-9_]/gi, '');
      const res = await client.query(`SELECT data FROM ${safeTable} WHERE store_id = $1 AND ${safeField} = $2 LIMIT 1`, [storeId, idVal]);
      if (res.rows.length === 0) return null;
      const data = res.rows[0].data;
      return (typeof data === 'string' ? JSON.parse(data) : data) as T;
    });
  }

  public async upsertProduct(product: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const itemSn = product.item_sn || product.id || `PROD-${Date.now()}`;
      const payload = { ...product, item_sn: itemSn, store_id: storeId };
      await client.query(`
        INSERT INTO products (
          item_sn, store_id, item_name, quantity, item_cost, selling_price,
          product_measure_unit, quantity_per_unit, product_category, reorder_level,
          supplier_id, item_picture, status, expiry_date, bulk_unit, conversion_factor,
          bulk_selling_price, bulk_item_cost, allow_loose_sales, data, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW()
        )
        ON CONFLICT (store_id, item_sn) DO UPDATE SET
          item_name = excluded.item_name,
          quantity = excluded.quantity,
          item_cost = excluded.item_cost,
          selling_price = excluded.selling_price,
          product_measure_unit = excluded.product_measure_unit,
          quantity_per_unit = excluded.quantity_per_unit,
          product_category = excluded.product_category,
          reorder_level = excluded.reorder_level,
          supplier_id = excluded.supplier_id,
          item_picture = excluded.item_picture,
          status = excluded.status,
          expiry_date = excluded.expiry_date,
          bulk_unit = excluded.bulk_unit,
          conversion_factor = excluded.conversion_factor,
          bulk_selling_price = excluded.bulk_selling_price,
          bulk_item_cost = excluded.bulk_item_cost,
          allow_loose_sales = excluded.allow_loose_sales,
          data = excluded.data,
          updated_at = NOW()
      `, [
        itemSn,
        storeId,
        product.item_name || 'Unnamed Item',
        Number(product.quantity) || 0,
        Number(product.item_cost) || 0,
        Number(product.selling_price) || 0,
        product.product_measure_unit || 'PCS',
        Number(product.quantity_per_unit) || 1,
        product.product_category || 'General',
        Number(product.reorder_level) || 10,
        product.supplier_id || null,
        product.item_picture || null,
        product.status || 'Active',
        product.expiry_date || null,
        product.bulk_unit || null,
        Number(product.conversion_factor) || 1,
        product.bulk_selling_price ? Number(product.bulk_selling_price) : null,
        product.bulk_item_cost ? Number(product.bulk_item_cost) : null,
        product.allow_loose_sales === false ? 0 : 1,
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async deleteProduct(itemSn: string, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      await client.query('DELETE FROM products WHERE store_id = $1 AND item_sn = $2', [storeId, itemSn]);
    });
    await this.touchVersion();
  }

  public async upsertCustomer(customer: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const customerId = customer.customer_id || customer.id || `CUST-${Date.now()}`;
      const payload = { ...customer, customer_id: customerId, store_id: storeId };
      await client.query(`
        INSERT INTO customers (
          customer_id, store_id, name, phone, balance, status, discount_percent,
          discount_notes, total_spent, purchase_count, last_purchase_date, preferred_product, data, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        ON CONFLICT (store_id, customer_id) DO UPDATE SET
          name = excluded.name,
          phone = excluded.phone,
          balance = excluded.balance,
          status = excluded.status,
          discount_percent = excluded.discount_percent,
          discount_notes = excluded.discount_notes,
          total_spent = excluded.total_spent,
          purchase_count = excluded.purchase_count,
          last_purchase_date = excluded.last_purchase_date,
          preferred_product = excluded.preferred_product,
          data = excluded.data,
          updated_at = NOW()
      `, [
        customerId,
        storeId,
        customer.name || 'Anonymous Customer',
        customer.phone || null,
        Number(customer.balance) || 0,
        customer.status || 'Active',
        Number(customer.discount_percent) || 0,
        customer.discount_notes || null,
        Number(customer.total_spent) || 0,
        Number(customer.purchase_count) || 0,
        customer.last_purchase_date ? new Date(customer.last_purchase_date) : null,
        customer.preferred_product || null,
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async deleteCustomer(customerId: string, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      await client.query('DELETE FROM customers WHERE store_id = $1 AND customer_id = $2', [storeId, customerId]);
    });
    await this.touchVersion();
  }

  public async upsertSupplier(supplier: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const supplierId = supplier.supplier_id || supplier.id || `SUP-${Date.now()}`;
      const payload = { ...supplier, supplier_id: supplierId, store_id: storeId };
      await client.query(`
        INSERT INTO suppliers (supplier_id, store_id, supplier_name, status, data, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (store_id, supplier_id) DO UPDATE SET
          supplier_name = excluded.supplier_name,
          status = excluded.status,
          data = excluded.data,
          updated_at = NOW()
      `, [
        supplierId,
        storeId,
        supplier.supplier_name || 'Unnamed Supplier',
        supplier.status || 'Active',
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async deleteSupplier(supplierId: string, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      await client.query('DELETE FROM suppliers WHERE store_id = $1 AND supplier_id = $2', [storeId, supplierId]);
    });
    await this.touchVersion();
  }

  public async upsertEmployee(employee: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const staffId = employee.staff_id || employee.id || `STAFF-${Date.now()}`;
      const payload = { ...employee, staff_id: staffId, store_id: storeId };
      await client.query(`
        INSERT INTO employees (staff_id, store_id, staff_name, username, role, pin, status, data, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (store_id, staff_id) DO UPDATE SET
          staff_name = excluded.staff_name,
          username = excluded.username,
          role = excluded.role,
          pin = coalesce(excluded.pin, employees.pin),
          status = excluded.status,
          data = excluded.data,
          updated_at = NOW()
      `, [
        staffId,
        storeId,
        employee.staff_name || 'Staff Member',
        employee.username || null,
        employee.role || 'Cashier',
        employee.pin || null,
        employee.status || 'Active',
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async deleteEmployee(staffId: string, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      await client.query('DELETE FROM employees WHERE store_id = $1 AND staff_id = $2', [storeId, staffId]);
    });
    await this.touchVersion();
  }

  public async addSale(sale: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const txId = sale.transaction_id || sale.id || `TX-${Date.now()}`;
      const payload = { ...sale, transaction_id: txId, store_id: storeId };
      await client.query(`
        INSERT INTO sales (
          transaction_id, store_id, invoice_number, timestamp, cashier_id, pos_terminal_id,
          pos_terminal_name, customer_id, final_amount, payment_method, bank_name,
          bank_account_number, payment_reference, payment_splits, discount_applied,
          discount_reason, discount_authorized_by, discount_rule_id, status,
          is_historical_import, migration_batch_id, data, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW()
        )
        ON CONFLICT (store_id, transaction_id) DO UPDATE SET
          data = excluded.data,
          status = excluded.status,
          updated_at = NOW()
      `, [
        txId,
        storeId,
        sale.invoice_number || null,
        new Date(sale.timestamp || Date.now()),
        sale.cashier_id || null,
        sale.pos_terminal_id || null,
        sale.pos_terminal_name || null,
        sale.customer_id || null,
        Number(sale.final_amount ?? sale.total_amount) || 0,
        sale.payment_method || 'Cash',
        sale.bank_name || null,
        sale.bank_account_number || null,
        sale.payment_reference || null,
        sale.payment_splits ? JSON.stringify(sale.payment_splits) : null,
        Number(sale.discount_applied) || 0,
        sale.discount_reason || null,
        sale.discount_authorized_by || null,
        sale.discount_rule_id || null,
        sale.status || 'COMPLETED',
        sale.is_historical_import ? 1 : 0,
        sale.migration_batch_id || null,
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async addRefund(refund: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const refundId = refund.refund_id || refund.id || `REF-${Date.now()}`;
      const payload = { ...refund, refund_id: refundId, store_id: storeId };
      await client.query(`
        INSERT INTO refunds (
          refund_id, store_id, original_transaction_id, item_sn, date_time, staff_id,
          refund_amount, payment_method, pos_terminal_id, pos_terminal_name,
          bank_name, bank_account_number, payment_reference, authorized_by,
          is_full_refund, disbursement_channel, cashier_staff_id, bank_account_id, data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (store_id, refund_id) DO NOTHING
      `, [
        refundId,
        storeId,
        refund.original_transaction_id || null,
        refund.item_sn || null,
        new Date(refund.date_time || Date.now()),
        refund.staff_id || null,
        Number(refund.refund_amount) || 0,
        refund.payment_method || 'Cash',
        refund.pos_terminal_id || null,
        refund.pos_terminal_name || null,
        refund.bank_name || null,
        refund.bank_account_number || null,
        refund.payment_reference || null,
        refund.authorized_by || null,
        refund.is_full_refund === false ? 0 : 1,
        refund.disbursement_channel || 'ORIGINAL_CHANNEL',
        refund.cashier_staff_id || null,
        refund.bank_account_id || null,
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async addAuditLog(auditLog: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = auditLog.id || `AUD-${Date.now()}`;
      const payload = { ...auditLog, id, store_id: storeId };
      await client.query(`
        INSERT INTO audit_logs (
          id, store_id, timestamp, user_id, staff_id, staff_name, role,
          action, category, severity, details, tamper_hash, data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (store_id, id) DO NOTHING
      `, [
        id,
        storeId,
        new Date(auditLog.timestamp || Date.now()),
        auditLog.user_id || auditLog.staff_id || null,
        auditLog.staff_id || null,
        auditLog.staff_name || null,
        auditLog.role || null,
        auditLog.action || 'GENERAL_ACTION',
        auditLog.category || 'System',
        auditLog.severity || 'INFO',
        auditLog.details || null,
        auditLog.tamper_hash || null,
        JSON.stringify(payload),
      ]);
    });
  }

  public async addCycleCount(cycleCount: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const countId = cycleCount.count_id || cycleCount.id || `CC-${Date.now()}`;
      const payload = { ...cycleCount, count_id: countId, store_id: storeId };
      await client.query(`
        INSERT INTO cycle_counts (count_id, store_id, date_time, item_sn, data)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (store_id, count_id) DO NOTHING
      `, [
        countId,
        storeId,
        new Date(cycleCount.date_time || Date.now()),
        cycleCount.item_sn || null,
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async addStockTransfer(transfer: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = transfer.transfer_id || transfer.id || `ST-${Date.now()}`;
      const payload = { ...transfer, transfer_id: id, store_id: storeId };
      await client.query(`
        INSERT INTO stock_transfers (transfer_id, store_id, date_time, item_sn, status, data)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (store_id, transfer_id) DO NOTHING
      `, [
        id,
        storeId,
        new Date(transfer.date_time || Date.now()),
        transfer.item_sn || null,
        transfer.status || 'COMPLETED',
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async addParkedOrder(order: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = order.id || `PARK-${Date.now()}`;
      const payload = { ...order, id, store_id: storeId };
      await client.query(`
        INSERT INTO parked_orders (id, store_id, created_at, cashier_id, data)
        VALUES ($1, $2, NOW(), $3, $4)
        ON CONFLICT (store_id, id) DO UPDATE SET data = excluded.data
      `, [id, storeId, order.cashier_id || null, JSON.stringify(payload)]);
    });
  }

  public async deleteParkedOrder(id: string, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      await client.query('DELETE FROM parked_orders WHERE store_id = $1 AND id = $2', [storeId, id]);
    });
  }

  public async addVoidedOrder(order: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = order.void_id || order.id || `VOID-${Date.now()}`;
      const payload = { ...order, void_id: id, store_id: storeId };
      await client.query(`
        INSERT INTO voided_orders (void_id, store_id, voided_at, cashier_id, data)
        VALUES ($1, $2, NOW(), $3, $4)
        ON CONFLICT (store_id, void_id) DO NOTHING
      `, [id, storeId, order.cashier_id || null, JSON.stringify(payload)]);
    });
  }

  public async upsertPosTerminal(terminal: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = terminal.id || `TERM-${Date.now()}`;
      const payload = { ...terminal, id, store_id: storeId };
      await client.query(`
        INSERT INTO pos_terminals (
          id, store_id, name, type, status, is_default, provider, terminal_id,
          account_name, account_number, bank_name, assigned_location, ip_address,
          app_version, last_heartbeat, pending_outbox_count, is_locked, lock_reason, data, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW()
        )
        ON CONFLICT (store_id, id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status,
          is_default = excluded.is_default,
          ip_address = excluded.ip_address,
          app_version = excluded.app_version,
          last_heartbeat = excluded.last_heartbeat,
          pending_outbox_count = excluded.pending_outbox_count,
          is_locked = excluded.is_locked,
          lock_reason = excluded.lock_reason,
          data = excluded.data,
          updated_at = NOW()
      `, [
        id,
        storeId,
        terminal.name || 'Terminal',
        terminal.type || 'COUNTER_REGISTER',
        terminal.status || 'Active',
        terminal.is_default ? 1 : 0,
        terminal.provider || null,
        terminal.terminal_id || null,
        terminal.account_name || null,
        terminal.account_number || null,
        terminal.bank_name || null,
        terminal.assigned_location || null,
        terminal.ip_address || null,
        terminal.app_version || '2.4.0',
        terminal.last_heartbeat ? new Date(terminal.last_heartbeat) : null,
        Number(terminal.pending_outbox_count) || 0,
        terminal.is_locked ? 1 : 0,
        terminal.lock_reason || null,
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async deletePosTerminal(id: string, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      await client.query('DELETE FROM pos_terminals WHERE store_id = $1 AND id = $2', [storeId, id]);
    });
    await this.touchVersion();
  }

  public async addCashTransfer(transfer: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = transfer.id || transfer.transfer_id || `CT-${Date.now()}`;
      const payload = { ...transfer, id, transfer_id: id, store_id: storeId };
      await client.query(`
        INSERT INTO cash_transfers (id, store_id, timestamp, cashier_staff_id, amount, transfer_type, data)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (store_id, id) DO NOTHING
      `, [
        id,
        storeId,
        new Date(transfer.date_time || transfer.timestamp || Date.now()),
        transfer.cashier_staff_id || null,
        Number(transfer.amount_transferred ?? transfer.amount) || 0,
        transfer.transfer_type || 'POS_TO_BANK',
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async addCustomerDebtRepayment(repayment: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = repayment.repayment_id || repayment.id || `REP-${Date.now()}`;
      const payload = { ...repayment, repayment_id: id, store_id: storeId };
      await client.query(`
        INSERT INTO customer_debt_repayments (
          repayment_id, store_id, customer_id, customer_name, amount_paid, payment_method,
          date_time, staff_id, staff_name, previous_balance, remaining_balance, data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (store_id, repayment_id) DO NOTHING
      `, [
        id,
        storeId,
        repayment.customer_id,
        repayment.customer_name || null,
        Number(repayment.amount_paid) || 0,
        repayment.payment_method || 'Cash',
        new Date(repayment.date_time || Date.now()),
        repayment.staff_id || null,
        repayment.staff_name || null,
        Number(repayment.previous_balance) || 0,
        Number(repayment.remaining_balance) || 0,
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async getCustomerDebtRepayments(storeId: string = 'store_default'): Promise<any[]> {
    return this.getTable('customer_debt_repayments', storeId);
  }

  public async getReceiptSettings(storeId: string = 'store_default'): Promise<any> {
    return this.withTenant(storeId, async (client) => {
      const res = await client.query('SELECT data FROM receipt_settings WHERE store_id = $1 LIMIT 1', [storeId]);
      if (res.rows.length === 0) return DEFAULT_RECEIPT_CONFIG;
      const data = res.rows[0].data;
      return typeof data === 'string' ? JSON.parse(data) : data;
    });
  }

  public async upsertReceiptSettings(settings: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = settings.id || 'DEFAULT_RECEIPT_CONFIG';
      await client.query(`
        INSERT INTO receipt_settings (id, store_id, data, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (store_id, id) DO UPDATE SET data = excluded.data, updated_at = NOW()
      `, [id, storeId, JSON.stringify(settings)]);
    });
    await this.touchVersion();
  }

  public async getDiscountSecurityConfig(storeId: string = 'store_default'): Promise<any> {
    return this.withTenant(storeId, async (client) => {
      const res = await client.query('SELECT data FROM discount_settings WHERE store_id = $1 LIMIT 1', [storeId]);
      if (res.rows.length === 0) return DEFAULT_DISCOUNT_SECURITY_CONFIG;
      const data = res.rows[0].data;
      return typeof data === 'string' ? JSON.parse(data) : data;
    });
  }

  public async upsertDiscountSecurityConfig(config: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = config.id || 'DISCOUNT_SECURITY_CONFIG';
      await client.query(`
        INSERT INTO discount_settings (id, store_id, data, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (store_id, id) DO UPDATE SET data = excluded.data, updated_at = NOW()
      `, [id, storeId, JSON.stringify(config)]);
    });
    await this.touchVersion();
  }

  public async getCategories(storeId: string = 'store_default'): Promise<any[]> {
    return this.getTable('categories', storeId);
  }

  public async upsertCategory(category: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const id = category.id || `CAT-${Date.now()}`;
      const payload = { ...category, id, store_id: storeId };
      await client.query(`
        INSERT INTO categories (id, store_id, name, description, data)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (store_id, id) DO UPDATE SET name = excluded.name, description = excluded.description, data = excluded.data
      `, [id, storeId, category.name, category.description || null, JSON.stringify(payload)]);
    });
    await this.touchVersion();
  }

  public async deleteCategory(id: string, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      await client.query('DELETE FROM categories WHERE store_id = $1 AND id = $2', [storeId, id]);
    });
    await this.touchVersion();
  }

  public async getDiscountRules(storeId: string = 'store_default'): Promise<any[]> {
    return this.getTable('discount_rules', storeId);
  }

  public async upsertDiscountRule(rule: any, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      const ruleId = rule.rule_id || rule.id || `RULE-${Date.now()}`;
      const payload = { ...rule, rule_id: ruleId, store_id: storeId };
      await client.query(`
        INSERT INTO discount_rules (
          rule_id, store_id, name, description, condition_type, threshold_value,
          discount_type, discount_value, scope, requires_manager_approval,
          max_discount_cap, is_active, data, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        ON CONFLICT (store_id, rule_id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          condition_type = excluded.condition_type,
          threshold_value = excluded.threshold_value,
          discount_type = excluded.discount_type,
          discount_value = excluded.discount_value,
          scope = excluded.scope,
          requires_manager_approval = excluded.requires_manager_approval,
          max_discount_cap = excluded.max_discount_cap,
          is_active = excluded.is_active,
          data = excluded.data,
          updated_at = NOW()
      `, [
        ruleId,
        storeId,
        rule.name,
        rule.description || null,
        rule.condition_type,
        Number(rule.threshold_value) || 0,
        rule.discount_type,
        Number(rule.discount_value) || 0,
        rule.scope || 'BASKET',
        rule.requires_manager_approval ? 1 : 0,
        rule.max_discount_cap ? Number(rule.max_discount_cap) : null,
        rule.is_active === false ? 0 : 1,
        JSON.stringify(payload),
      ]);
    });
    await this.touchVersion();
  }

  public async deleteDiscountRule(ruleId: string, storeId: string = 'store_default'): Promise<void> {
    await this.withTenant(storeId, async (client) => {
      await client.query('DELETE FROM discount_rules WHERE store_id = $1 AND rule_id = $2', [storeId, ruleId]);
    });
    await this.touchVersion();
  }

  /**
   * Registers a new tenant and automatically provisions tailored vertical presets.
   */
  public async registerTenant(params: {
    business_name: string;
    vertical?: string;
    currency?: string;
    phone?: string;
    address?: string;
    admin_name?: string;
    admin_username?: string;
    admin_pin?: string;
  }): Promise<any> {
    const storeId = `store_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const vertical = (params.vertical || 'COLD_ROOM').toUpperCase();
    const currency = (params.currency || 'NGN').toUpperCase();
    const now = new Date().toISOString();

    const tenantRecord = {
      store_id: storeId,
      business_name: params.business_name,
      vertical,
      currency,
      phone: params.phone || '',
      address: params.address || '',
      status: 'ACTIVE',
      settings: {
        vertical,
        currency,
        onboarding_completed: true,
      },
      created_at: now,
      updated_at: now,
    };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Create Tenant row
      await client.query(`
        INSERT INTO tenants (store_id, business_name, vertical, currency, phone, address, status, settings, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      `, [
        storeId,
        params.business_name,
        vertical,
        currency,
        params.phone || null,
        params.address || null,
        'ACTIVE',
        JSON.stringify(tenantRecord.settings),
      ]);

      // Set RLS scope to newly created tenant
      await client.query("SELECT set_config('app.current_store_id', $1, true)", [storeId]);

      // Seed Store Manager/Admin
      const adminPin = params.admin_pin || '1234';
      const adminHashedPin = hashPin(adminPin);
      const adminStaff = {
        staff_id: `STAFF-${storeId.slice(-4).toUpperCase()}-001`,
        staff_name: params.admin_name || 'Store Owner',
        username: params.admin_username || 'owner',
        role: 'Admin',
        pin: adminHashedPin,
        shift_time: 'Full Day',
        date_hired: now.slice(0, 10),
        status: 'Active',
        store_id: storeId,
      };
      await client.query(`
        INSERT INTO employees (staff_id, store_id, staff_name, username, role, pin, status, data, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      `, [adminStaff.staff_id, storeId, adminStaff.staff_name, adminStaff.username, adminStaff.role, adminStaff.pin, adminStaff.status, JSON.stringify(adminStaff)]);

      // Seed Vertical-Specific Categories & Presets
      let verticalCategories: Array<{ id: string; name: string; description: string }> = [];
      let defaultUnits: string[] = ['PCS'];

      if (vertical === 'COLD_ROOM') {
        defaultUnits = ['KG', 'CARTON', 'HALF_CARTON', 'BASKET', 'PCS'];
        verticalCategories = [
          { id: `CAT-${storeId}-1`, name: 'Freshwater Fish', description: 'Catfish, Tilapia, and live river varieties' },
          { id: `CAT-${storeId}-2`, name: 'Saltwater Fish', description: 'Mackerel, Croaker, Titus, and ocean fish' },
          { id: `CAT-${storeId}-3`, name: 'Frozen Seafood', description: 'Shrimps, Prawns, Calamari, and Crab' },
          { id: `CAT-${storeId}-4`, name: 'Dried & Smoked Fish', description: 'Kilishi, smoked catfish, stockfish' },
        ];
      } else if (vertical === 'PROVISION_STORE') {
        defaultUnits = ['PCS', 'PACK', 'CARTON', 'ROLL', 'DOZEN'];
        verticalCategories = [
          { id: `CAT-${storeId}-1`, name: 'Packaged Foods & Grains', description: 'Rice, pasta, flour, noodles, canned goods' },
          { id: `CAT-${storeId}-2`, name: 'Beverages & Drinks', description: 'Juices, water, soft drinks, milk, teas' },
          { id: `CAT-${storeId}-3`, name: 'Toiletries & Hygiene', description: 'Soaps, detergents, toothpaste, tissues' },
          { id: `CAT-${storeId}-4`, name: 'Seasoning & Condiments', description: 'Spices, oils, tomato paste, cubes' },
        ];
      } else if (vertical === 'BOUTIQUE') {
        defaultUnits = ['PCS', 'PAIR', 'SET'];
        verticalCategories = [
          { id: `CAT-${storeId}-1`, name: "Men's Apparel", description: 'Shirts, trousers, suits, traditional wear' },
          { id: `CAT-${storeId}-2`, name: "Women's Apparel", description: 'Dresses, skirts, tops, evening gowns' },
          { id: `CAT-${storeId}-3`, name: 'Footwear & Shoes', description: 'Sneakers, sandals, loafers, heels' },
          { id: `CAT-${storeId}-4`, name: 'Fashion Accessories', description: 'Belts, bags, watches, jewelry' },
        ];
      } else {
        defaultUnits = ['PCS', 'BOX', 'CARTON'];
        verticalCategories = [
          { id: `CAT-${storeId}-1`, name: 'General Merchandise', description: 'Standard consumer retail items' },
          { id: `CAT-${storeId}-2`, name: 'Electronics & Accessories', description: 'Cables, chargers, peripherals' },
          { id: `CAT-${storeId}-3`, name: 'Household Essentials', description: 'Cleaning supplies, home utensils' },
        ];
      }

      for (const cat of verticalCategories) {
        const catData = { ...cat, store_id: storeId, created_at: now };
        await client.query(`
          INSERT INTO categories (id, store_id, name, description, data)
          VALUES ($1, $2, $3, $4, $5)
        `, [cat.id, storeId, cat.name, cat.description, JSON.stringify(catData)]);
      }

      // Seed Receipt Configuration
      const receiptConfig = {
        ...DEFAULT_RECEIPT_CONFIG,
        business_name: params.business_name,
        address_line1: params.address || 'Store Location',
        address_line2: `${params.phone || ''} | ${vertical}`,
        phone_numbers: params.phone || '+234 800 000 0000',
        store_id: storeId,
        updated_at: now,
      };
      await client.query(`
        INSERT INTO receipt_settings (id, store_id, data, updated_at)
        VALUES ('DEFAULT_RECEIPT_CONFIG', $1, $2, NOW())
      `, [storeId, JSON.stringify(receiptConfig)]);

      // Seed Discount Security Config
      const discountConfig = {
        ...DEFAULT_DISCOUNT_SECURITY_CONFIG,
        store_id: storeId,
        updated_at: now,
      };
      await client.query(`
        INSERT INTO discount_settings (id, store_id, data, updated_at)
        VALUES ('DISCOUNT_SECURITY_CONFIG', $1, $2, NOW())
      `, [storeId, JSON.stringify(discountConfig)]);

      // Seed Default Cashier Register POS Terminal
      const terminalData = {
        id: `TERM-${storeId.slice(-4).toUpperCase()}-01`,
        name: 'Main Counter Register 1',
        type: 'COUNTER_REGISTER',
        status: 'Active',
        is_default: 1,
        store_id: storeId,
        app_version: '2.4.0',
        created_at: now,
      };
      await client.query(`
        INSERT INTO pos_terminals (id, store_id, name, type, status, is_default, app_version, data, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 1, $6, $7, NOW(), NOW())
      `, [terminalData.id, storeId, terminalData.name, terminalData.type, terminalData.status, terminalData.app_version, JSON.stringify(terminalData)]);

      await client.query('COMMIT');
      return {
        ...tenantRecord,
        adminStaff: {
          staff_id: adminStaff.staff_id,
          username: adminStaff.username,
          staff_name: adminStaff.staff_name,
        },
        supported_units: defaultUnits,
        categories: verticalCategories,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async listTenants(): Promise<any[]> {
    const res = await this.pool.query('SELECT store_id, business_name, vertical, currency, phone, address, status, settings, created_at FROM tenants ORDER BY created_at ASC');
    return res.rows.map(r => ({
      ...r,
      settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings,
    }));
  }

  public async getTenant(storeId: string): Promise<any | null> {
    const res = await this.pool.query('SELECT * FROM tenants WHERE store_id = $1 LIMIT 1', [storeId]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      ...r,
      settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings,
    };
  }

  public async processSyncPush(params: {
    store_id: string;
    terminal_id: string;
    events: any[];
  }): Promise<{
    success: boolean;
    processed_event_ids: string[];
    rejected_event_ids: Array<{ event_id: string; reason: string }>;
    server_version: number;
    synced_at: string;
  }> {
    const storeId = params.store_id || 'store_default';
    const terminalId = params.terminal_id || 'UNKNOWN';
    const processedEventIds: string[] = [];
    const rejectedEventIds: Array<{ event_id: string; reason: string }> = [];

    await this.transaction(storeId, async (client) => {
      for (const event of params.events) {
        try {
          if (!event.event_id || !event.entity_type || !event.mutation_type) {
            rejectedEventIds.push({ event_id: event.event_id || 'UNKNOWN', reason: 'Missing event metadata' });
            continue;
          }

          // Idempotency check against sync_inbox_log
          const checkRes = await client.query('SELECT event_id FROM sync_inbox_log WHERE store_id = $1 AND event_id = $2', [storeId, event.event_id]);
          if (checkRes.rows.length > 0) {
            processedEventIds.push(event.event_id);
            continue;
          }

          // Apply entity mutation
          const payload = event.payload;
          switch (event.entity_type) {
            case 'sale':
              if (event.mutation_type === 'INSERT' || event.mutation_type === 'UPSERT') {
                await this.addSale(payload, storeId);
              }
              break;
            case 'product':
              if (event.mutation_type === 'INSERT' || event.mutation_type === 'UPSERT') {
                await this.upsertProduct(payload, storeId);
              } else if (event.mutation_type === 'DELETE') {
                await this.deleteProduct(event.entity_id, storeId);
              }
              break;
            case 'customer':
              if (event.mutation_type === 'INSERT' || event.mutation_type === 'UPSERT') {
                await this.upsertCustomer(payload, storeId);
              } else if (event.mutation_type === 'DELETE') {
                await this.deleteCustomer(event.entity_id, storeId);
              }
              break;
            case 'customer_debt_repayment':
              if (event.mutation_type === 'INSERT') {
                await this.addCustomerDebtRepayment(payload, storeId);
              }
              break;
            case 'cash_transfer':
              if (event.mutation_type === 'INSERT') {
                await this.addCashTransfer(payload, storeId);
              }
              break;
            case 'refund':
              if (event.mutation_type === 'INSERT') {
                await this.addRefund(payload, storeId);
              }
              break;
            default:
              break;
          }

          // Record in sync_inbox_log
          await client.query(`
            INSERT INTO sync_inbox_log (event_id, store_id, terminal_id, entity_type, entity_id, processed_at, server_version)
            VALUES ($1, $2, $3, $4, $5, NOW(), 1)
          `, [event.event_id, storeId, terminalId, event.entity_type, event.entity_id || 'UNKNOWN']);

          processedEventIds.push(event.event_id);
        } catch (err: any) {
          rejectedEventIds.push({ event_id: event.event_id, reason: err.message });
        }
      }
    });

    const newVersion = await this.touchVersion();
    return {
      success: true,
      processed_event_ids: processedEventIds,
      rejected_event_ids: rejectedEventIds,
      server_version: newVersion,
      synced_at: new Date().toISOString(),
    };
  }

  public async getSyncDeltas(storeId: string = 'store_default', sinceVersion: number = 0): Promise<{
    success: boolean;
    up_to_date: boolean;
    current_version: number;
    deltas?: any;
  }> {
    const meta = await this.getMetadata();
    const currentVersion = meta.version;

    if (sinceVersion >= currentVersion) {
      return {
        success: true,
        up_to_date: true,
        current_version: currentVersion,
      };
    }

    const [products, customers, categories, discountRules, receiptSettings, employees] = await Promise.all([
      this.getTable('products', storeId),
      this.getTable('customers', storeId),
      this.getCategories(storeId),
      this.getDiscountRules(storeId),
      this.getReceiptSettings(storeId),
      this.getTable('employees', storeId),
    ]);

    return {
      success: true,
      up_to_date: false,
      current_version: currentVersion,
      deltas: {
        products,
        customers,
        categories,
        discountRules,
        receiptSettings,
        employees,
      },
    };
  }

  public async recordTerminalHeartbeat(params: {
    terminal_id: string;
    store_id: string;
    terminal_name?: string;
    app_version?: string;
    ip_address?: string;
    pending_outbox_count?: number;
  }): Promise<{ success: boolean; is_locked: boolean; lock_reason?: string; terminal: any }> {
    const storeId = params.store_id || 'store_default';
    const terminalId = params.terminal_id;
    const now = new Date().toISOString();

    return this.withTenant(storeId, async (client) => {
      const existing = await client.query('SELECT is_locked, lock_reason, data FROM pos_terminals WHERE store_id = $1 AND id = $2', [storeId, terminalId]);
      let terminalData: any = {};
      let isLocked = false;
      let lockReason: string | undefined = undefined;

      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        terminalData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        isLocked = Boolean(row.is_locked);
        lockReason = row.lock_reason || terminalData.lock_reason;
      }

      terminalData.id = terminalId;
      terminalData.store_id = storeId;
      if (params.terminal_name) terminalData.name = params.terminal_name;
      if (params.app_version) terminalData.app_version = params.app_version;
      if (params.ip_address) terminalData.ip_address = params.ip_address;
      terminalData.last_heartbeat = now;
      terminalData.pending_outbox_count = Number(params.pending_outbox_count) || 0;
      terminalData.is_locked = isLocked;
      terminalData.lock_reason = lockReason;

      await client.query(`
        INSERT INTO pos_terminals (
          id, store_id, name, type, status, ip_address, app_version,
          last_heartbeat, pending_outbox_count, is_locked, lock_reason, data, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, NOW())
        ON CONFLICT (store_id, id) DO UPDATE SET
          name = coalesce(excluded.name, pos_terminals.name),
          ip_address = excluded.ip_address,
          app_version = excluded.app_version,
          last_heartbeat = excluded.last_heartbeat,
          pending_outbox_count = excluded.pending_outbox_count,
          data = excluded.data,
          updated_at = NOW()
      `, [
        terminalId,
        storeId,
        terminalData.name || `Terminal (${terminalId.slice(-6)})`,
        terminalData.type || 'COUNTER_REGISTER',
        terminalData.status || 'Active',
        params.ip_address || '',
        params.app_version || '2.4.0',
        Number(params.pending_outbox_count) || 0,
        isLocked ? 1 : 0,
        lockReason || null,
        JSON.stringify(terminalData),
      ]);

      return {
        success: true,
        is_locked: isLocked,
        lock_reason: lockReason,
        terminal: terminalData,
      };
    });
  }

  public async setTerminalLockState(
    terminalId: string,
    storeId: string,
    isLocked: boolean,
    reason?: string
  ): Promise<{ success: boolean; terminal: any }> {
    return this.withTenant(storeId, async (client) => {
      const existing = await client.query('SELECT data FROM pos_terminals WHERE store_id = $1 AND id = $2', [storeId, terminalId]);
      let terminalData: any = {};
      if (existing.rows.length > 0) {
        terminalData = typeof existing.rows[0].data === 'string' ? JSON.parse(existing.rows[0].data) : existing.rows[0].data;
      }

      terminalData.id = terminalId;
      terminalData.store_id = storeId;
      terminalData.is_locked = isLocked;
      terminalData.lock_reason = isLocked ? (reason || 'Remotely locked by store management') : null;
      terminalData.locked_at = isLocked ? new Date().toISOString() : null;

      await client.query(`
        UPDATE pos_terminals SET
          is_locked = $1,
          lock_reason = $2,
          data = $3,
          updated_at = NOW()
        WHERE store_id = $4 AND id = $5
      `, [isLocked ? 1 : 0, terminalData.lock_reason, JSON.stringify(terminalData), storeId, terminalId]);

      await this.touchVersion();
      return { success: true, terminal: terminalData };
    });
  }

  public async getFleetTerminals(storeId?: string): Promise<any[]> {
    const effectiveStoreId = storeId || 'store_default';
    return this.withTenant(effectiveStoreId, async (client) => {
      const res = effectiveStoreId === '*' || effectiveStoreId === 'system_superadmin'
        ? await client.query('SELECT id, name, store_id, ip_address, app_version, last_heartbeat, pending_outbox_count, is_locked, lock_reason, data FROM pos_terminals')
        : await client.query('SELECT id, name, store_id, ip_address, app_version, last_heartbeat, pending_outbox_count, is_locked, lock_reason, data FROM pos_terminals WHERE store_id = $1', [effectiveStoreId]);

      const now = Date.now();
      return res.rows.map(r => {
        const parsed = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        const heartbeatMs = r.last_heartbeat ? new Date(r.last_heartbeat).getTime() : 0;
        const isOnline = (now - heartbeatMs) < 45000;
        return {
          ...parsed,
          id: r.id,
          name: r.name || parsed.name || r.id,
          store_id: r.store_id,
          ip_address: r.ip_address || parsed.ip_address || '127.0.0.1',
          app_version: r.app_version || parsed.app_version || '2.4.0',
          last_heartbeat: r.last_heartbeat || null,
          pending_outbox_count: Number(r.pending_outbox_count) || 0,
          is_locked: Boolean(r.is_locked),
          lock_reason: r.lock_reason || null,
          is_online: isOnline,
        };
      });
    });
  }

  public async getSnapshot(storeId: string = 'store_default'): Promise<any> {
    const meta = await this.getMetadata();
    const [
      products,
      customers,
      suppliers,
      employees,
      sales,
      refunds,
      auditLogs,
      cycleCounts,
      stockTransfers,
      parkedOrders,
      voidedOrders,
      posTerminals,
      cashTransfers,
      customerDebtRepayments,
      receiptSettings,
      discountSecurityConfig,
      categories,
      discountRules,
    ] = await Promise.all([
      this.getTable('products', storeId),
      this.getTable('customers', storeId),
      this.getTable('suppliers', storeId),
      this.getTable('employees', storeId),
      this.getTable('sales', storeId),
      this.getTable('refunds', storeId),
      this.getTable('audit_logs', storeId),
      this.getTable('cycle_counts', storeId),
      this.getTable('stock_transfers', storeId),
      this.getTable('parked_orders', storeId),
      this.getTable('voided_orders', storeId),
      this.getTable('pos_terminals', storeId),
      this.getTable('cash_transfers', storeId),
      this.getCustomerDebtRepayments(storeId),
      this.getReceiptSettings(storeId),
      this.getDiscountSecurityConfig(storeId),
      this.getCategories(storeId),
      this.getDiscountRules(storeId),
    ]);

    return {
      version: meta.version,
      lastUpdated: meta.lastUpdated,
      store_id: storeId,
      products,
      customers,
      suppliers,
      employees,
      purchaseOrders: [],
      sales,
      refunds,
      auditLogs,
      cycleCounts,
      stockTransfers,
      parkedOrders,
      voidedOrders,
      posTerminals,
      cashTransfers,
      customerDebtRepayments,
      receiptSettings,
      discountSecurityConfig,
      categories,
      discountRules,
    };
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

