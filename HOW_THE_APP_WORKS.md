# 📘 How the Application Works (Operational & Technical Architecture)
### Enterprise Hybrid Multi-Tenant POS & Inventory Management System
**KIID FROM DREAM POS (v2.4.0)**

---

## 1. Executive Overview & System Architecture

### 1.1 Core Purpose
**KIID FROM DREAM POS** is an enterprise-grade, offline-first, multi-tenant Point of Sale (POS) and inventory management platform designed for high-volume retail, wholesale, and cold-storage operations (e.g. Fish Cold Rooms, Provision Supermarkets, and Boutiques).

The application bridges the gap between **unreliable physical store internet connectivity** and **centralized executive cloud oversight**. Cashiers can process transactions at lightning speed even during complete internet blackouts, while business owners monitor multi-branch turnover, gross margins, and inventory health in real-time from anywhere in the world.

---

### 1.2 The Hybrid Dual-Tier Model

The application operates across two distinct deployment targets that seamlessly synchronize:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               CLOUD MANAGEMENT TIER (Vercel)                           │
│  • Used by: SuperAdmins, Business Owners, Remote Supervisors                           │
│  • Stack: Vite + React 19 + Tailwind CSS hosted on Vercel Edge CDN                     │
│  • Function: Executive P&L, Audit Logs, Customer Debt Recovery, Multi-Branch Fleet      │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTPS / REST / SSE Stream
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                CLOUD API BACKEND (Railway)                             │
│  • Stack: Node.js + Express + TypeScript running in a Docker container on Railway      │
│  • Primary Database: Supabase PostgreSQL 16 (with Row-Level Security)                  │
│  • Storage: Cloudflare R2 / AWS S3 S3-compatible cloud object storage                  │
└───────────────────────────────────────────▲────────────────────────────────────────────┘
                                            │ Sync Outbox Push & Pull Deltas
                                            │ (Periodic + SSE Reactive Reconnect)
┌───────────────────────────────────────────┴────────────────────────────────────────────┐
│                         IN-STORE CASHIER DESKTOP TERMINAL (Electron)                   │
│  • Used by: Store Cashiers, Floor Supervisors, Weight Scale Operators                 │
│  • Stack: Electron 44 + Embedded Node.js + Local SQLite (`node:sqlite`) + IndexedDB    │
│  • Resiliency: 100% offline-capable checkout; zero latency; thermal receipt printing   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Web Management Dashboard (Cloud)**:
   - Hosted on Vercel at `https://your-pos.vercel.app`.
   - Connects directly to the live Railway Cloud API.
   - Provides real-time financial reporting, cashier shift audits, customer credit settlement, price overrides, and tenant onboarding.

2. **Desktop In-Store Terminal (Local / Offline)**:
   - Packaged as a native Windows installer (`setup.exe`) via Electron.
   - Embeds a local SQLite database (`node:sqlite`) and client IndexedDB outbox.
   - If internet drops, cashiers continue scanning, adding to cart, printing thermal receipts, and taking cash/transfers without interruption.
   - As soon as connectivity returns, the local sync engine automatically pushes queued transactions to the cloud without manual cashier intervention.

---

## 2. Multi-Tenancy & Data Isolation Model

The platform is built from the ground up as a **multi-tenant SaaS**. Multiple distinct business organizations share the same cloud database while maintaining strict logical isolation.

### 2.1 The `store_id` Partition Key
Every operational entity in the system is partitioned by a unique tenant identifier called `store_id`:
- Default seeded store: `store_default` (`KIID FROM DREAM LTD`).
- Dynamically onboarded stores: `store_uuid_...` (e.g. `store_coldroom_lekki`, `store_provision_abuja`).

Composite primary keys on all tables begin with `store_id`:
```sql
PRIMARY KEY (store_id, transaction_id)
PRIMARY KEY (store_id, item_sn)
PRIMARY KEY (store_id, customer_id)
```
This guarantees indexing performance and prevents ID collisions across independent stores.

---

### 2.2 Kernel-Level Row-Level Security (RLS) in PostgreSQL
Unlike basic applications that rely solely on `WHERE store_id = '...'` in application code, this platform enforces data isolation at the **PostgreSQL kernel level**.

In [`server/db/schema.sql`](file:///server/db/schema.sql), all 21 operational tables have RLS enabled and forced:
```sql
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON sales
FOR ALL
USING (
    store_id = current_setting('app.current_store_id', true)
    OR current_setting('app.current_store_id', true) = '*'
    OR current_setting('app.current_store_id', true) = 'system_superadmin'
)
WITH CHECK (
    store_id = current_setting('app.current_store_id', true)
    OR current_setting('app.current_store_id', true) = '*'
    OR current_setting('app.current_store_id', true) = 'system_superadmin'
);
```

Whenever the backend leases a connection from the pool in [`server/db/postgres.ts`](file:///server/db/postgres.ts), it sets the session variable before executing queries:
```typescript
await client.query("SELECT set_config('app.current_store_id', $1, true)", [effectiveStoreId]);
```
- The third parameter `true` sets `LOCAL` scope (valid only for the duration of the leased client transaction).
- Even if an attacker executes raw SQL, PostgreSQL will refuse to return rows belonging to any other `store_id`.
- Platform SuperAdmins can pass `system_superadmin` or `*` to view global aggregated metrics.

---

### 2.3 Store Verticals & Onboarding Presets
When a new store is registered via the **Business Onboarding Wizard** ([`src/components/auth/BusinessOnboardingModal.tsx`](file:///src/components/auth/BusinessOnboardingModal.tsx)), the API triggers `registerTenant()` which seeds customized operational presets:

| Vertical Preset | Specialized Features Configured | Default Categories Seeded | Default Measure Units |
| :--- | :--- | :--- | :--- |
| **`COLD_ROOM`**<br>*(Fish & Frozen Foods)* | • Dual unit tracking (Kilograms vs. Cartons)<br>• Conversion factors (e.g. 20kg per carton)<br>• Thaw weight loss & shrinkage audits<br>• Electronic scale tare weight calibration | `Frozen Fish`, `Seafood`, `Poultry`, `Frozen Meat`, `Packaging` | `KG`, `CTN`, `BAG`, `PCS` |
| **`PROVISION_STORE`**<br>*(Supermarkets & Retail)* | • Barcode scanner quick checkout<br>• Loose item vs. Outer pack breakdown<br>• Expiry date alerts & reorder thresholds | `Beverages`, `Grains & Cereals`, `Dairy & Breakfast`, `Toiletries`, `Snacks` | `PCS`, `ROLL`, `PACK`, `CARTON` |
| **`BOUTIQUE`**<br>*(Fashion & Apparel)* | • Size & color variations<br>• Garment barcode tags<br>• Seasonal collections | `Men's Wear`, `Women's Wear`, `Children`, `Footwear`, `Accessories` | `PCS`, `PAIR`, `SET` |

---

## 3. Database Architecture (Hybrid Cloud + Local)

### 3.1 Cloud Database: Supabase PostgreSQL 16
The cloud master database uses PostgreSQL 16 with JSONB document storage and GIN indexes:
- **Relational Columns for Indexing**: Fields queried frequently (`store_id`, `item_sn`, `timestamp`, `cashier_id`, `status`) are structured relational columns.
- **JSONB for Schema Evolution**: The `data JSONB` column stores polymorphic payload attributes without requiring constant database migrations.
- **GIN Indexing**: `CREATE INDEX idx_products_data_gin ON products USING gin (data);` enables high-speed full-document searches inside JSON fields.

#### Supabase Connection Pool Management
Supabase provides PgBouncer in Session Mode (port 6543) with a connection limit of 15 connections on standard tiers. To eliminate `EMAXCONNSESSION` pool exhaustion errors:
1. **Client Ceiling**: [`server/db/postgres.ts`](file:///server/db/postgres.ts) enforces `max: 10` and `connectionTimeoutMillis: 10000`.
2. **Single-Lease Snapshots**:
   Instead of opening 18 separate database connections inside `Promise.all` for `getSnapshot()`, the backend leases **a single client**, applies `set_config('app.current_store_id')` once, and streams all 18 tables through that single connection via `getTableWithClient()`.

---

### 3.2 Local Terminal Database: SQLite & IndexedDB
On local desktop cashiers:
1. **Node SQLite (`node:sqlite`)**:
   - Packaged inside the Electron embedded backend.
   - Stored in `%APPDATA%/smartsales-pos/data/pos_database.db`.
   - Uses write-ahead logging (WAL mode) and passive checkpointing for instant write speeds.
2. **Client IndexedDB (`smartsales_pos_idb`)**:
   - Runs directly in the browser/Chromium renderer.
   - Contains two object stores:
     - `outbox_events`: Stores queued offline mutations waiting for cloud push.
     - `sync_meta`: Tracks the last synced server version and heartbeat timestamp.

---

### 3.3 Dual-Engine Fallback Logic in `server.ts`
The backend in [`server.ts`](file:///server.ts) automatically detects its operational environment:
```typescript
const databaseUrl = process.env.DATABASE_URL;
export let pgDb: PosPostgresDatabase | null = null;

if (databaseUrl) {
  console.log('[POSTGRES] Multi-tenant Cloud PostgreSQL enabled with Row-Level Security (RLS).');
  pgDb = new PosPostgresDatabase(databaseUrl);
}
```
- **If `DATABASE_URL` is set** (Railway / Cloud deployment): The server initializes PostgreSQL, validates the schema, executes startup migrations, and routes sync calls to Supabase.
- **If `DATABASE_URL` is absent** (Local standalone Electron terminal): `pgDb` remains `null`, and the server automatically falls back to local SQLite storage.

---

## 4. Offline-First Outbox Sync Engine

The heart of the in-store cashier terminal is the **Asynchronous Outbox Sync Engine** implemented across [`src/utils/syncOutbox.ts`](file:///src/utils/syncOutbox.ts) and [`src/utils/idbStorage.ts`](file:///src/utils/idbStorage.ts).

### 4.1 Step-by-Step Checkout & Offline Push Lifecycle

```
[Cashier Rings Sale]
         │
         ▼
[1. Local State Updated Instantly]  <── (Receipt prints in 100ms; customer leaves counter)
         │
         ▼
[2. Enqueue Outbox Mutation]        <── (Event saved to IndexedDB 'outbox_events' store)
         │
         ├─────────────────────────────────────────┐
         ▼                                         ▼
   [ONLINE DETECTED]                       [OFFLINE DETECTED]
         │                                         │
[3. Push Payload to Cloud API]             [Queued in IndexedDB]
  POST /api/v1/sync/push                           │
         │                                 [Network Resumes]
         ▼                                         │
[4. Server Validates & Ingests]                    ▼
  • Sets tenant RLS session                [Background Runner Flushes]
  • Inserts to 'sales' table                       │
  • Logs to 'sync_inbox_log'                       │
  • Increments server version                      │
  • Broadcasts SSE 'SYNC_PUSH_PROCESSED'           │
         │                                         │
         ▼                                         │
[5. Client Receives Processed IDs] ◄───────────────┘
  • Deletes event from IndexedDB
  • Sync pill turns green: "Synced"
```

1. **Cart Checkout**:
   When the cashier clicks *Complete Sale*, `processCheckout()` in `PosContext.tsx` instantly reduces local stock, records the sale in local state, and calls:
   ```typescript
   enqueueOutboxMutation({
     store_id: currentStoreId,
     entity_type: 'SALE',
     entity_id: newTransaction.transaction_id,
     mutation_type: 'INSERT',
     payload: newTransaction,
   });
   ```
2. **IndexedDB Durability**:
   The event is written to IndexedDB with status `PENDING`. Even if the computer is turned off or loses power immediately after, the sale is never lost.
3. **Batch Push (`pushPendingOutbox`)**:
   The outbox engine periodically collects all `PENDING` mutations and posts them to `/api/v1/sync/push`:
   ```json
   {
     "store_id": "store_default",
     "terminal_id": "TERM-POS-01",
     "events": [
       {
         "event_id": "evt_01j...",
         "entity_type": "SALE",
         "entity_id": "TXN-9921",
         "mutation_type": "INSERT",
         "payload": { ... }
       }
     ]
   }
   ```
4. **Server Ingestion & De-duplication**:
   The cloud server processes the batch within a transaction. It checks `sync_inbox_log` using `event_id` to guarantee that duplicate network retries are safely ignored (idempotent ingestion).
5. **Reconciliation**:
   The server responds with `{ success: true, processed_event_ids: [...] }`. The client removes processed events from IndexedDB and updates `lastServerVersion`.

---

### 4.2 Incremental Delta Pulls (`pullServerDeltas`)
When managers add new products, update prices, or adjust discount rules on the cloud dashboard:
- The server increments its atomic metadata version (`touchVersion()`).
- In-store terminals listen via Server-Sent Events (`/api/events`) or poll `/api/v1/sync/pull?since_version=X`.
- The server queries only updated tables using `COALESCE(updated_at, created_at) DESC`.
- The terminal merges the new products, categories, and settings into its local cache without reloading the page or disrupting the cashier.

---

## 5. Authentication & Access Control (RBAC)

Security is implemented in [`src/utils/security.ts`](file:///src/utils/security.ts) and [`server/middleware/tenantContext.ts`](file:///server/middleware/tenantContext.ts).

### 5.1 Salted SHA-256 PIN Hashing
Cashiers and managers unlock terminals using numeric PINs. Plaintext PINs are never stored in the database:
```typescript
export function hashPin(pin: string, existingSalt?: string): string {
  const salt = existingSalt || generateSalt(); // 16 random hex characters
  const hash = sha256(`${salt}_SMARTSALES_POS_${cleanPin}`);
  return `${salt}:${hash}`;
}
```
- Verification uses `timingSafeEqual()` to protect against side-channel timing attacks.
- Legacy plaintext PINs are automatically verified and upgraded to salted hashes upon first successful login.

---

### 5.2 Role Hierarchy & Permissions

| Role | Operational Scope | Permitted Actions | Restricted Actions |
| :--- | :--- | :--- | :--- |
| **`Cashier`** | Store Sales Floor | • Cart checkout & receipt printing<br>• Hold/Park walk-in customer orders<br>• Shift cash drawer floats | ❌ Price overrides<br>❌ Store discount PIN config<br>❌ Debt write-offs<br>❌ Deleting inventory |
| **`Manager`** | Store Management | • Everything Cashier can do<br>• Authorize store discount PINs<br>• Stock adjustments & purchase orders<br>• Customer debt repayments<br>• Shift reconciliation | ❌ System factory reset<br>❌ Tenant billing settings |
| **`SuperAdmin`** | Executive Oversight | • Multi-tenant business registration<br>• Executive P&L & Gross Margin reports<br>• Terminal fleet remote lock/unlock<br>• Full system audit trail & factory reset | ⚠️ Excluded from daily cashier sales floor operations to prevent cash drawer attribution skew |

---

### 5.3 Signed Bearer Session Tokens
The backend uses lightweight cryptographic session tokens without external JWT dependencies:
```typescript
// Token format: storeId.staffId.role.expiresAt.signature
const payload = `${storeId}.${staffId}.${role}.${expiresAt}`;
const signature = sha256(`${payload}.${SECRET_APP_KEY}`).slice(0, 32);
const token = `${payload}.${signature}`;
```
- Signed using `process.env.JWT_SECRET` (or `SESSION_SECRET`).
- Expire automatically after 14 hours (`ttlHours: 14`).
- Express middleware ([`server/middleware/tenantContext.ts`](file:///server/middleware/tenantContext.ts)) validates token signatures on every API call and extracts `req.storeId` and `req.user`.

---

## 6. Core Functional Modules & Workflows

### 6.1 Point of Sale (POS) Checkout Workflow
Located in [`src/components/pos/PosTerminal.tsx`](file:///src/components/pos/PosTerminal.tsx):
1. **Product Lookup**: Real-time search by barcode (EAN-13, UPC), item name, or category filter.
2. **Order Parking**: Cashiers can park up to 10 active walk-in baskets if a customer steps away to get cash, allowing the next customer in line to be served immediately.
3. **Tender Modes**:
   - **Cash**: Calculator computes exact change due against cash tendered.
   - **POS Terminal (Card)**: Selects registered terminal (e.g. Moniepoint, OPay) and records the transaction RRN / slip reference.
   - **Bank Transfer**: Displays corporate bank account number with a one-click copy button and captures transfer session IDs.
   - **Credit / Debt**: Permitted only for registered customer accounts; enforces customer credit limits and calculates balance due.
   - **Split Tender**: Splits a single sale across Cash + POS Terminal or Cash + Bank Transfer with automatic balance validation.
4. **Discount Authorization**:
   - Discretionary discounts exceeding preset limits require entering the Manager Store Discount PIN in a secure modal.

---

### 6.2 Inventory & Bulk Conversion Logic
Located in [`src/components/inventory/InventoryManager.tsx`](file:///src/components/inventory/InventoryManager.tsx):
- **Bulk vs. Loose Sales**: Supports selling by either the Master Unit (e.g. `CARTON` at ₦45,000) or Loose Unit (e.g. `KG` at ₦2,500/kg).
- **Automatic Stock Depletion**: Selling 5kg automatically reduces carton stock by `5 / 20 = 0.25 cartons`.
- **Reorder Warnings**: Visual amber/red alerts when quantity falls below `reorder_level`.
- **Cycle Counts**: Authorizes periodic stock audits and records discrepancies in `cycle_counts`.

---

### 6.3 Receipt Printing & Hardware Integration
Located in [`src/components/receipt/ReceiptModal.tsx`](file:///src/components/receipt/ReceiptModal.tsx):
- **Thermal Printing Styles**: Formatted in CSS with `@media print` rules for standard **58mm** and **80mm** thermal receipt rolls.
- **Branding Customization**: Configured in `receipt_settings` (company name, address lines, phone numbers, Tax/TIN numbers, return policy notice, and promotional footer).
- **Silent Printing**: In Electron desktop terminals, receipts can be dispatched directly to the default USB/Ethernet thermal printer without opening standard Windows print dialogs.

---

## 7. Deployment & Infrastructure Map

```
                ┌─────────────────────────────────────────────────────────┐
                │                      GitHub (main)                      │
                │        Repository: hcmdbolu/KFD-hybrid.git             │
                └───────────────────────────┬─────────────────────────────┘
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
       ┌───────────────────────────┐                 ┌───────────────────────────┐
       │      Vercel (Frontend)    │                 │      Railway (Backend)    │
       │  • Root: ./               │                 │  • Docker container       │
       │  • Build: npm run build   │                 │  • Port: 3000 -> 0.0.0.0  │
       │  • SPA Rewrites:          │                 │  • Health: /api/health    │
       │    vercel.json            │                 │  • Auto-restarts on push  │
       │  • Env: VITE_API_BASE_URL │                 └─────────────┬─────────────┘
       └───────────────────────────┘                               │
                                                                   ▼
                                                     ┌───────────────────────────┐
                                                     │    Supabase (Database)    │
                                                     │  • PostgreSQL 16          │
                                                     │  • Port 6543 (Pooler)     │
                                                     │  • 21 Tables + RLS        │
                                                     └───────────────────────────┘
```

1. **Frontend (Vercel)**:
   - Root configuration file: [`vercel.json`](file:///vercel.json).
   - Contains rewrite rules routing all client paths `/(.*)` to `/index.html`, eliminating 404 errors on browser page reloads.
   - `src/utils/apiClient.ts` automatically intercepts relative `/api/*` fetch calls and redirects them to `VITE_API_BASE_URL`.
2. **Backend (Railway)**:
   - Listens on `process.env.PORT` and binds to host `0.0.0.0`.
   - Express CORS is restricted to the live Vercel domain (`CORS_ORIGIN`).
   - Serves the lightweight health check endpoint at `GET /api/health`.
3. **Database (Supabase)**:
   - PostgreSQL 16 hosted on AWS/GCP via Supabase.
   - Connected via Session Mode connection pooler (port 6543) using `ssl: { rejectUnauthorized: false }`.
4. **Desktop Packaging (Electron Builder)**:
   - Configured in [`electron-builder.json`](file:///electron-builder.json).
   - Generates two production Windows distributions in `release/`:
     - NSIS Installer: `KIID FROM DREAM POS Setup 2.4.0.exe`.
     - Portable Binary: `KIID FROM DREAM POS 2.4.0.exe`.

---

## 8. Project Directory & Key File Reference Map

```
kfd-hybrid/
├── server.ts                       # Express REST API, CORS, SSE broadcast, & static asset server
├── vercel.json                     # Vercel SPA client-side rewrite rules
├── package.json                    # Dependencies, scripts (build:all, electron:dist), & engines
├── electron-builder.json           # Windows NSIS and portable executable installer configuration
├── DEPLOYMENT_RUNBOOK.md           # Step-by-step production deployment guide (Supabase/Railway/Vercel)
├── HOW_THE_APP_WORKS.md            # System operational & architectural documentation (this document)
│
├── server/
│   ├── db/
│   │   ├── adapter.ts              # Common IPosDatabase TypeScript interface
│   │   ├── postgres.ts             # PostgreSQL pool adapter with single-client snapshot queries
│   │   ├── sqlite.ts               # Local SQLite database adapter using node:sqlite
│   │   └── schema.sql              # PostgreSQL DDL schema with 21 tables, indexes, and RLS policies
│   ├── middleware/
│   │   └── tenantContext.ts        # Tenant extraction, JWT authentication, & role guards
│   └── utils/
│       └── s3Storage.ts            # S3/R2 cloud object storage client for product images & logos
│
├── electron/
│   ├── main.cjs                    # Electron background process, window lifecycle, & embedded server
│   └── preload.cjs                 # Secure IPC preload bridge between Electron and React
│
└── src/
    ├── main.tsx                    # React DOM root entry point
    ├── App.tsx                     # Main application layout, sidebar navigation, & tab router
    ├── types.ts                    # Global TypeScript interfaces for sales, products, tenants, etc.
    │
    ├── context/
    │   └── PosContext.tsx          # Central application state, cart calculations, & sync loops
    │
    ├── components/
    │   ├── pos/
    │   │   └── PosTerminal.tsx     # Checkout interface, barcode scanner, cart, & tender channels
    │   ├── inventory/
    │   │   └── InventoryManager.tsx# Stock table, bulk carton conversion, & reorder warnings
    │   ├── reports/
    │   │   └── ReportingDashboard.tsx # Executive P&L waterfall, shift matrices, & turnover analytics
    │   ├── customers/
    │   │   └── CustomerAccountsManager.tsx # Accounts receivable ledger & debt settlement
    │   ├── receipt/
    │   │   └── ReceiptModal.tsx    # Thermal receipt formatting (58mm/80mm) & silent print dispatch
    │   ├── auth/
    │   │   └── BusinessOnboardingModal.tsx # Multi-tenant vertical onboarding wizard
    │   └── admin/
    │       └── TerminalFleetManager.tsx # POS terminal hardware heartbeat & remote lock manager
    │
    └── utils/
        ├── apiClient.ts            # Central API URL resolver & fetch interceptor
        ├── syncOutbox.ts           # Offline mutation queue engine & batch push/pull handlers
        ├── idbStorage.ts           # IndexedDB browser storage wrapper for offline events
        └── security.ts             # Salted SHA-256 PIN hashing & cryptographic session tokens
```
