-- ============================================================================
-- KIID FROM DREAM POS & INVENTORY SYSTEM - MULTI-TENANT POSTGRESQL SCHEMA
-- Engine: PostgreSQL 16+
-- Features: Row-Level Security (RLS), JSONB Storage with GIN Indexes, Multi-Tenant store_id Partitioning
-- ============================================================================

-- Ensure required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Tenants & Organizations Table (Global SaaS Metadata)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    store_id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    vertical TEXT NOT NULL DEFAULT 'COLD_ROOM',
    currency TEXT NOT NULL DEFAULT 'NGN',
    phone TEXT,
    email TEXT,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_vertical ON tenants(vertical);

-- ----------------------------------------------------------------------------
-- 2. Metadata / System Configuration Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. Products Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    item_sn TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    item_name TEXT,
    quantity NUMERIC(12, 3) DEFAULT 0,
    item_cost NUMERIC(14, 2) DEFAULT 0,
    selling_price NUMERIC(14, 2) DEFAULT 0,
    product_measure_unit TEXT DEFAULT 'PCS',
    quantity_per_unit NUMERIC(12, 3) DEFAULT 1,
    product_category TEXT DEFAULT 'General',
    reorder_level NUMERIC(12, 3) DEFAULT 10,
    supplier_id TEXT,
    item_picture TEXT,
    status TEXT DEFAULT 'Active',
    expiry_date TEXT,
    bulk_unit TEXT,
    conversion_factor NUMERIC(12, 3) DEFAULT 1,
    bulk_selling_price NUMERIC(14, 2),
    bulk_item_cost NUMERIC(14, 2),
    allow_loose_sales SMALLINT DEFAULT 1,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, item_sn)
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(store_id, item_name);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(store_id, status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(store_id, product_category);
CREATE INDEX IF NOT EXISTS idx_products_data_gin ON products USING gin (data);

-- ----------------------------------------------------------------------------
-- 4. Customers & Accounts Receivable Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    customer_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    name TEXT,
    phone TEXT,
    balance NUMERIC(14, 2) DEFAULT 0,
    status TEXT DEFAULT 'Active',
    discount_percent NUMERIC(5, 2) DEFAULT 0,
    discount_notes TEXT,
    total_spent NUMERIC(14, 2) DEFAULT 0,
    purchase_count INTEGER DEFAULT 0,
    last_purchase_date TIMESTAMPTZ,
    preferred_product TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(store_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_balance ON customers(store_id, balance);
CREATE INDEX IF NOT EXISTS idx_customers_data_gin ON customers USING gin (data);

-- ----------------------------------------------------------------------------
-- 5. Suppliers Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    supplier_name TEXT,
    status TEXT DEFAULT 'Active',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_data_gin ON suppliers USING gin (data);

-- ----------------------------------------------------------------------------
-- 6. Employees & Staff Users Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    staff_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    staff_name TEXT NOT NULL,
    username TEXT,
    role TEXT NOT NULL DEFAULT 'Cashier',
    pin TEXT,
    status TEXT DEFAULT 'Active',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(store_id, role);
CREATE INDEX IF NOT EXISTS idx_employees_username ON employees(store_id, username);
CREATE INDEX IF NOT EXISTS idx_employees_data_gin ON employees USING gin (data);

-- ----------------------------------------------------------------------------
-- 7. Purchase Orders Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    po_number TEXT,
    supplier_id TEXT,
    status TEXT DEFAULT 'PENDING',
    expected_delivery_date TIMESTAMPTZ,
    actual_delivery_date TIMESTAMPTZ,
    notes TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(store_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_data_gin ON purchase_orders USING gin (data);

-- ----------------------------------------------------------------------------
-- 8. Sales Transactions Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
    transaction_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    invoice_number TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    cashier_id TEXT,
    pos_terminal_id TEXT,
    pos_terminal_name TEXT,
    customer_id TEXT,
    final_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'Cash',
    bank_name TEXT,
    bank_account_number TEXT,
    payment_reference TEXT,
    payment_splits JSONB,
    discount_applied NUMERIC(14, 2) DEFAULT 0,
    discount_reason TEXT,
    discount_authorized_by TEXT,
    discount_rule_id TEXT,
    status TEXT DEFAULT 'COMPLETED',
    is_historical_import SMALLINT DEFAULT 0,
    migration_batch_id TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales(store_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(store_id, cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_terminal ON sales(store_id, pos_terminal_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(store_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(store_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_sales_data_gin ON sales USING gin (data);

-- ----------------------------------------------------------------------------
-- 9. Refunds Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refunds (
    refund_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    original_transaction_id TEXT,
    item_sn TEXT,
    date_time TIMESTAMPTZ NOT NULL,
    staff_id TEXT,
    refund_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'Cash',
    pos_terminal_id TEXT,
    pos_terminal_name TEXT,
    bank_name TEXT,
    bank_account_number TEXT,
    payment_reference TEXT,
    authorized_by TEXT,
    is_full_refund SMALLINT DEFAULT 1,
    disbursement_channel TEXT DEFAULT 'ORIGINAL_CHANNEL',
    cashier_staff_id TEXT,
    bank_account_id TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, refund_id)
);

CREATE INDEX IF NOT EXISTS idx_refunds_orig_tx ON refunds(store_id, original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_refunds_data_gin ON refunds USING gin (data);

-- ----------------------------------------------------------------------------
-- 10. Audit Logs Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id TEXT,
    staff_id TEXT,
    staff_name TEXT,
    role TEXT,
    action TEXT NOT NULL,
    category TEXT,
    severity TEXT DEFAULT 'INFO',
    details TEXT,
    tamper_hash TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, id)
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(store_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_logs(store_id, category);
CREATE INDEX IF NOT EXISTS idx_audit_data_gin ON audit_logs USING gin (data);

-- ----------------------------------------------------------------------------
-- 11. Cycle Counts Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_counts (
    count_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    date_time TIMESTAMPTZ NOT NULL,
    item_sn TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, count_id)
);

CREATE INDEX IF NOT EXISTS idx_cycle_counts_data_gin ON cycle_counts USING gin (data);

-- ----------------------------------------------------------------------------
-- 12. Stock Transfers Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfers (
    transfer_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    date_time TIMESTAMPTZ NOT NULL,
    item_sn TEXT,
    status TEXT DEFAULT 'COMPLETED',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, transfer_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_data_gin ON stock_transfers USING gin (data);

-- ----------------------------------------------------------------------------
-- 13. Parked & Voided Orders Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parked_orders (
    id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cashier_id TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (store_id, id)
);

CREATE TABLE IF NOT EXISTS voided_orders (
    void_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    voided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cashier_id TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (store_id, void_id)
);

-- ----------------------------------------------------------------------------
-- 14. POS Terminals & Hardware Registers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_terminals (
    id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    name TEXT,
    type TEXT,
    status TEXT DEFAULT 'Active',
    is_default SMALLINT DEFAULT 0,
    provider TEXT,
    terminal_id TEXT,
    account_name TEXT,
    account_number TEXT,
    bank_name TEXT,
    assigned_location TEXT,
    ip_address TEXT,
    app_version TEXT,
    last_heartbeat TIMESTAMPTZ,
    pending_outbox_count INTEGER DEFAULT 0,
    is_locked SMALLINT DEFAULT 0,
    lock_reason TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, id)
);

CREATE INDEX IF NOT EXISTS idx_pos_terminals_data_gin ON pos_terminals USING gin (data);

-- ----------------------------------------------------------------------------
-- 15. Cash Transfers & Drawer Drops
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_transfers (
    id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL,
    cashier_staff_id TEXT,
    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    transfer_type TEXT DEFAULT 'POS_TO_BANK',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, id)
);

CREATE INDEX IF NOT EXISTS idx_cash_transfers_cashier ON cash_transfers(store_id, cashier_staff_id);
CREATE INDEX IF NOT EXISTS idx_cash_transfers_data_gin ON cash_transfers USING gin (data);

-- ----------------------------------------------------------------------------
-- 16. Customer Debt Repayments (Settlements)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_debt_repayments (
    repayment_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,
    customer_name TEXT,
    amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'Cash',
    date_time TIMESTAMPTZ NOT NULL,
    staff_id TEXT,
    staff_name TEXT,
    previous_balance NUMERIC(14, 2) DEFAULT 0,
    remaining_balance NUMERIC(14, 2) DEFAULT 0,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, repayment_id)
);

CREATE INDEX IF NOT EXISTS idx_debt_repayments_cust ON customer_debt_repayments(store_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_debt_repayments_date ON customer_debt_repayments(store_id, date_time);
CREATE INDEX IF NOT EXISTS idx_debt_repayments_data_gin ON customer_debt_repayments USING gin (data);

-- ----------------------------------------------------------------------------
-- 17. Receipt Settings & Branding
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipt_settings (
    id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, id)
);

-- ----------------------------------------------------------------------------
-- 18. Discount Settings & Security Config
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discount_settings (
    id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, id)
);

-- ----------------------------------------------------------------------------
-- 19. Categories Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, id)
);

CREATE INDEX IF NOT EXISTS idx_categories_data_gin ON categories USING gin (data);

-- ----------------------------------------------------------------------------
-- 20. Discount Rules Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discount_rules (
    rule_id TEXT NOT NULL,
    store_id TEXT NOT NULL DEFAULT 'store_default' REFERENCES tenants(store_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    condition_type TEXT NOT NULL,
    threshold_value NUMERIC(14, 2) NOT NULL,
    discount_type TEXT NOT NULL,
    discount_value NUMERIC(14, 2) NOT NULL,
    scope TEXT NOT NULL DEFAULT 'BASKET',
    requires_manager_approval SMALLINT NOT NULL DEFAULT 0,
    max_discount_cap NUMERIC(14, 2),
    is_active SMALLINT NOT NULL DEFAULT 1,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_discount_rules_data_gin ON discount_rules USING gin (data);

-- ----------------------------------------------------------------------------
-- 21. Sync Protocol Tables (Edge-to-Cloud Integration)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_outbox (
    event_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES tenants(store_id) ON DELETE CASCADE,
    terminal_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    mutation_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    client_timestamp TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    client_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_queue ON sync_outbox(store_id, status, created_at);

CREATE TABLE IF NOT EXISTS sync_inbox_log (
    event_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES tenants(store_id) ON DELETE CASCADE,
    terminal_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    server_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_inbox_store ON sync_inbox_log(store_id, processed_at);

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- Strict store_id multi-tenant isolation enforced at the PostgreSQL kernel level.
-- Queries check `current_setting('app.current_store_id', true)`.
-- If 'app.current_store_id' is set to '*' or 'system_superadmin', full platform access is granted.
-- ============================================================================

DO $$
DECLARE
    tbl text;
    operational_tables text[] := ARRAY[
        'products', 'customers', 'suppliers', 'employees', 'purchase_orders',
        'sales', 'refunds', 'audit_logs', 'cycle_counts', 'stock_transfers',
        'parked_orders', 'voided_orders', 'pos_terminals', 'cash_transfers',
        'customer_debt_repayments', 'receipt_settings', 'discount_settings',
        'categories', 'discount_rules', 'sync_outbox', 'sync_inbox_log'
    ];
BEGIN
    FOREACH tbl IN ARRAY operational_tables LOOP
        -- Enable and Force RLS
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);

        -- Drop existing policy if exists to avoid collision
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I;', tbl);

        -- Create dynamic tenant isolation policy
        EXECUTE format('
            CREATE POLICY tenant_isolation_policy ON %I
            FOR ALL
            USING (
                store_id = current_setting(''app.current_store_id'', true)
                OR current_setting(''app.current_store_id'', true) = ''*''
                OR current_setting(''app.current_store_id'', true) = ''system_superadmin''
            )
            WITH CHECK (
                store_id = current_setting(''app.current_store_id'', true)
                OR current_setting(''app.current_store_id'', true) = ''*''
                OR current_setting(''app.current_store_id'', true) = ''system_superadmin''
            );
        ', tbl);
    END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- Backward-Compatible Column Migrations (Idempotent for live existing databases)
-- ----------------------------------------------------------------------------
ALTER TABLE discount_rules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE discount_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE discount_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE discount_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE voided_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE voided_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ----------------------------------------------------------------------------
-- Ensure Default Tenant & Platform Metadata
-- ----------------------------------------------------------------------------
INSERT INTO tenants (
    store_id, business_name, vertical, currency, status, settings, created_at, updated_at
) VALUES (
    'store_default',
    'KIID FROM DREAM LTD',
    'COLD_ROOM',
    'NGN',
    'ACTIVE',
    '{"default": true, "seeded": true}'::jsonb,
    NOW(),
    NOW()
) ON CONFLICT (store_id) DO NOTHING;

INSERT INTO metadata (key, value, updated_at)
VALUES (
    'db_info',
    '{"version": 1, "migrated_to": "postgresql", "migrated_at": "2026-11-02T22:00:00Z"}'::jsonb,
    NOW()
) ON CONFLICT (key) DO NOTHING;

