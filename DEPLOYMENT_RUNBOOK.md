# 🚀 Production Deployment Runbook
### Complete Beginner's Guide to Deploying the 3-Tier POS & Inventory Cloud System
**Architecture: Supabase (PostgreSQL Database) + Railway (Backend API) + Vercel (Frontend Dashboard) + Electron (`setup.exe` Desktop Cashier)**

---

## 📖 Welcome & Overview

This runbook gives you exact, click-by-click instructions to deploy the entire POS & Multi-Tenant SaaS platform to the cloud from scratch. No prior cloud infrastructure experience is required.

### What We Are Building:
```
  ┌─────────────────────────────────────────────────────────────┐
  │                   1. Supabase (Database)                   │
  │  • Cloud PostgreSQL 16                                      │
  │  • Kernel-level Row-Level Security (RLS)                   │
  │  • Isolated store_id multi-tenant partitions                │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                     DATABASE_URL (Port 6543 / 5432)
                                 │
  ┌──────────────────────────────┴──────────────────────────────┐
  │                   2. Railway (Backend API)                 │
  │  • Node.js + Express REST API & SSE Sync Stream             │
  │  • Public HTTPS URL: https://your-api.up.railway.app        │
  │  • Multi-tenant session tokens, health checks, & outbox sync│
  └──────────────┬───────────────────────────────┬──────────────┘
                 │                               │
         VITE_API_BASE_URL               VITE_API_BASE_URL
                 │                               │
  ┌──────────────┴──────────────┐ ┌──────────────┴──────────────┐
  │   3. Vercel (Web Dashboard) │ │ 4. Desktop Cashier Terminal │
  │  • Live Web React App       │ │  • Windows `setup.exe`      │
  │  • Store Management & P&L   │ │  • Offline IndexedDB SQLite │
  │  • Customer Debt Settlement │ │  • Automatic cloud sync     │
  └─────────────────────────────┘ └─────────────────────────────┘
```

---

## 📑 Table of Contents
1. [Section 1: Prerequisites & Account Setup](#section-1-prerequisites--account-setup)
2. [Section 2: Supabase (Cloud Database Setup)](#section-2-supabase-cloud-database-setup)
3. [Section 3: Railway (Backend API Deployment)](#section-3-railway-backend-api-deployment)
4. [Section 4: Vercel (Frontend Web Dashboard Deployment)](#section-4-vercel-frontend-web-dashboard-deployment)
5. [Section 5: Linking Railway & Vercel Together](#section-5-linking-railway--vercel-together)
6. [Section 6: End-to-End Smoke Test (Verification)](#section-6-end-to-end-smoke-test-verification)
7. [Section 7: Packaging the Desktop Cashier App (`setup.exe`)](#section-7-packaging-the-desktop-cashier-app-setupexe)
8. [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Section 1: Prerequisites & Account Setup

Before starting, create free accounts on each of the following platforms:

1. **GitHub**: [https://github.com/signup](https://github.com/signup) — Stores our project source code.
2. **Supabase**: [https://supabase.com](https://supabase.com) — Provides our cloud PostgreSQL database.
3. **Railway**: [https://railway.com](https://railway.com) — Hosts our Express backend API.
4. **Vercel**: [https://vercel.com/signup](https://vercel.com/signup) — Hosts our React frontend web dashboard.

### Verifying Git Commits
Make sure all your latest files are committed and pushed to GitHub:
1. Open PowerShell or Terminal in the project folder:
   ```powershell
   cd "C:\Users\GSL IT\Desktop\kfd\kfd hybrid"
   ```
2. Check your working tree status:
   ```powershell
   git status
   ```
3. If any files show as modified or untracked, add, commit, and push them:
   ```powershell
   git add .
   git commit -m "feat: prepare production cloud deployment"
   git push origin main
   ```
4. Confirm you see `Your branch is up to date with 'origin/main'`.

---

## Section 2: Supabase (Cloud Database Setup)

Supabase provides our managed PostgreSQL database with Row-Level Security (RLS) to ensure that multiple stores (tenants) can safely share the database without seeing each other's data.

### Step 2.1: Create a New Supabase Project
1. Go to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Click the green **New Project** button.
3. Choose your Organization (e.g. personal).
4. Fill in the project details:
   - **Name**: `kfd-pos-cloud` (or any name you prefer)
   - **Database Password**: Choose a strong password (e.g. `KfdPosSecure2026!`).
     > [!IMPORTANT]
     > **Write down this password immediately!** You will need it in Step 2.3 and Section 3.
   - **Region**: Choose the region geographically closest to your physical stores (e.g., `Europe (Frankfurt)`, `Europe (London)`, or `US East (N. Virginia)`).
   - **Pricing Plan**: Select **Free tier**.
5. Click **Create new project**.
6. Wait 1–2 minutes while Supabase provisions the database.

---

### Step 2.2: Run the Multi-Tenant SQL Schema
Our database schema contains 21 pre-configured tables, GIN indexes, and kernel-level Row-Level Security (RLS) policies.

1. In your Supabase project dashboard, look at the left sidebar menu and click **SQL Editor** (icon with `>_`).
2. Click the **+ New query** button at the top.
3. In your code editor on your computer, open:
   [`server/db/schema.sql`](file:///server/db/schema.sql)
4. Select all text (`Ctrl + A`) and copy it (`Ctrl + C`).
5. Paste the entire SQL script into the Supabase SQL Editor query window (`Ctrl + V`).
6. Click the green **Run** button (or press `Ctrl + Enter`).
7. You will see a success message:
   ```text
   Success. No rows returned.
   ```
8. To verify: click **Table Editor** (grid icon) in the left sidebar. You will see all 21 tables created:
   - `tenants`, `metadata`, `products`, `customers`, `suppliers`, `employees`
   - `sales`, `refunds`, `audit_logs`, `pos_terminals`, `categories`, `sync_outbox`, etc.

---

### Step 2.3: Retrieve Your Database Connection String (`DATABASE_URL`)
1. In the Supabase left sidebar, click the **Project Settings** (gear icon ⚙️ at the very bottom).
2. Click **Database** under the *Configuration* menu.
3. Scroll down to the **Connection parameters** section and locate **Connection String**.
4. Click on the **URI** tab.
5. You will see two connection modes:
   - **Connection Pooler (Recommended for Cloud Hosting - Port 6543)**:
     ```text
     postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
     ```
   - **Direct Connection (Port 5432)**:
     ```text
     postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
     ```
6. Copy the **Connection Pooler URI (Port 6543)**.
7. Replace `[YOUR-PASSWORD]` with the password you created in Step 2.1.
   > [!TIP]
   > If your password contains special symbols (like `@`, `#`, or `$`), URL-encode them (e.g. `@` becomes `%40`, `#` becomes `%23`).
8. Save this complete string on your notepad. It should look like:
   ```text
   postgresql://postgres.abcdefghijklmnop:KfdPosSecure2026!@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```

---

## Section 3: Railway (Backend API Deployment)

Railway runs our Node.js Express server (`server.ts`) inside an isolated, auto-restarting cloud container.

### Step 3.1: Link Your GitHub Repository to Railway
1. Go to your [Railway Dashboard](https://railway.com/dashboard).
2. Click the **+ New Project** button.
3. Select **Deploy from GitHub repo**.
4. If prompted, authorize Railway to access your GitHub account.
5. In the list of repositories, select **`KFD-hybrid`** (or your repository name).
6. Click **Deploy Now**.
   *(Note: The initial deployment may temporarily fail or build with defaults — that is normal because we have not set environment variables yet!)*

---

### Step 3.2: Configure Railway Environment Variables
Our backend requires a few environment variables to know where to connect:

1. Click on the newly created service box in Railway to open its settings.
2. Click on the **Variables** tab at the top.
3. Click **+ Add Variable** (or **RAW Editor**) and enter the following variables one by one:

| Variable Name | Exact Value to Enter | Explanation |
| :--- | :--- | :--- |
| **`DATABASE_URL`** | *(Paste your complete Supabase connection string from Step 2.3)* | Connects the backend to your Supabase PostgreSQL database. |
| **`NODE_ENV`** | `production` | Tells Express and Vite to run in high-performance production mode. |
| **`HOST`** | `0.0.0.0` | Binds the server to all network interfaces so Railway can route traffic. |
| **`PORT`** | `3000` | Port for the container (Railway maps this automatically to HTTPS). |
| **`CORS_ORIGIN`** | `*` | *(Temporary wildcard; we will lock this to your Vercel URL in Section 5).* |
| **`JWT_SECRET`** | `kfd-super-secret-pos-jwt-key-2026-production` | Secret key used to encrypt cashier and manager session tokens. |

*(Optional Cloud Storage: If you are using Cloudflare R2 or AWS S3 for product images and receipt logos, also add `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, and `S3_PUBLIC_DOMAIN`).*

4. Railway will automatically save and restart the container.

---

### Step 3.3: Generate a Public HTTPS Domain
By default, Railway containers are private. We need to generate a public domain so our Vercel dashboard and desktop cashiers can reach the API:

1. In your Railway service page, click the **Settings** tab.
2. Scroll down to the **Networking** section.
3. Under **Public Networking**, click **Generate Domain**.
4. Railway will assign a public URL, for example:
   ```text
   https://kfd-hybrid-production.up.railway.app
   ```
5. **Copy this URL.** You will need it for Vercel in Section 4.

---

### Step 3.4: Verify Backend Health Check
1. In Railway, click the **Deployments** tab and click on the active deployment to view the build and runtime logs.
2. Confirm the logs display:
   ```text
   [POSTGRES] Multi-tenant Cloud PostgreSQL enabled with Row-Level Security (RLS).
   [POSTGRES] Applying multi-tenant schema with Row-Level Security...
   [POSTGRES] Schema, GIN indexes, and RLS policies initialized successfully.
   [POS SERVER] Centralized DB server running on http://0.0.0.0:3000 (Production)
   ```
3. Open your web browser and go to your Railway URL with `/api/health` appended:
   ```text
   https://your-api.up.railway.app/api/health
   ```
4. You should see a JSON response confirming database connectivity:
   ```json
   {
     "status": "ok",
     "timestamp": "2026-11-04T12:55:32.857Z",
     "version": 9950,
     "database": "postgresql",
     "time": "2026-11-04T12:55:32.857Z"
   }
   ```
   🎉 **Your Railway backend is 100% online and connected to Supabase!**

---

## Section 4: Vercel (Frontend Web Dashboard Deployment)

Vercel provides edge hosting for our React Vite frontend application.

### Step 4.1: Import Your GitHub Repository into Vercel
1. Log in to your [Vercel Dashboard](https://vercel.com/dashboard).
2. Click the **Add New...** button in the top right, then select **Project**.
3. Under **Import Git Repository**, find **`KFD-hybrid`** (click *Adjust GitHub App Permissions* if it does not appear).
4. Click **Import**.

---

### Step 4.2: Configure Vercel Build Settings & Environment Variables
1. In the **Configure Project** screen:
   - **Project Name**: `kfd-pos-dashboard` (or leave default).
   - **Framework Preset**: Verify it says **Vite** (Vercel automatically detects this).
   - **Root Directory**: Leave as `./`.
   - **Build Command**: Leave as default (`npm run build`).
   - **Output Directory**: Leave as default (`dist`).
2. Expand the **Environment Variables** section.
3. Add the following variable:
   - **Key / Name**: `VITE_API_BASE_URL`
   - **Value**: Your live Railway URL from Step 3.3 (e.g. `https://kfd-hybrid-production.up.railway.app`).
     > [!WARNING]
     > Do **NOT** include a trailing slash at the end (e.g. write `https://api.up.railway.app`, NOT `https://api.up.railway.app/`).

---

### Step 4.3: Deploy & Verify Client-Side Routing
1. Click the blue **Deploy** button.
2. Wait 30–60 seconds while Vercel builds the React application.
3. Once completed, confetti will appear with a screenshot of your app.
4. Click **Continue to Dashboard** or click the screenshot thumbnail.
5. Copy your live Vercel domain, for example:
   ```text
   https://kfd-pos-dashboard.vercel.app
   ```
6. **Test Page Refresh (SPA Rewrites)**:
   - Our repository already contains [`vercel.json`](file:///vercel.json) with:
     ```json
     {
       "rewrites": [
         { "source": "/(.*)", "destination": "/index.html" }
       ]
     }
     ```
   - Navigate to any sub-screen (like `/admin` or `/inventory`) and press `F5` (browser refresh). The page should reload smoothly without showing a "404 Not Found" error.

---

## Section 5: Linking Railway & Vercel Together

Now that we have our live Vercel domain, we should secure Railway's CORS policy so only our official frontend can interact with the cloud API.

1. Go back to your [Railway Dashboard](https://railway.com/dashboard).
2. Click on your backend service.
3. Click the **Variables** tab.
4. Find the **`CORS_ORIGIN`** variable (which we set to `*` earlier).
5. Edit its value to match your exact Vercel URL:
   ```text
   https://kfd-pos-dashboard.vercel.app
   ```
   *(If you also want to test from your local development computer, comma-separate them: `https://kfd-pos-dashboard.vercel.app,http://localhost:3000`).*
6. Railway will automatically save and redeploy your container in ~10 seconds.

---

## Section 6: End-to-End Smoke Test (Verification)

Let's test the entire live system from the frontend web dashboard down to Supabase.

### Step 6.1: Onboard a New Business Tenant
1. Open your live Vercel URL: `https://kfd-pos-dashboard.vercel.app`.
2. The **Business Onboarding Wizard** will appear (or click the store selector at the top to register a new tenant).
3. Select your Business Vertical:
   - **Fish Cold Room & Frozen Foods**: Configured for KG/Cartons, bulk discounting, and thaw shrinkage audits.
   - **Provision & Supermarket Store**: Configured for standard retail barcodes, packs, and fast checkout.
   - **Boutique & Fashion Store**: Configured for sizes, colors, and clothing lines.
4. Fill in:
   - **Business Name**: e.g., `Atlantic Cold Room Ltd`
   - **Phone & Email**: Contact details.
   - **Admin PIN**: e.g., `1234`
5. Click **Complete Setup & Launch Store**.

---

### Step 6.2: Verify Data in Supabase
1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Click **Table Editor** on the left menu.
3. Click on the **`tenants`** table:
   - You will see a newly inserted row with your store's name, vertical, and unique `store_id` (e.g. `store_...`).
4. Click on the **`categories`** and **`products`** tables:
   - Confirm that default categories and preset inventory items were automatically seeded with the matching `store_id`.

---

### Step 6.3: Process a Test Sale
1. On your live Vercel web app, navigate to the **POS Terminal**.
2. Click on an item to add it to your order basket.
3. Select a Customer (or Walk-In).
4. Click **Cash** or **POS Terminal** and enter the payment amount.
5. Click **Complete Sale & Print Receipt**.
6. A branded receipt dialog will open with a unique transaction number (e.g. `TXN-...`).
7. Check Supabase: click the **`sales`** table in the Supabase Table Editor. You will see the new sale row stored with exact timestamp, item totals, and payment breakdown!

---

## Section 7: Packaging the Desktop Cashier App (`setup.exe`)

For physical stores with unstable internet connections, cashiers should use the installed Windows desktop app. It allows 100% offline checkout and syncs automatically with Railway once internet is restored.

### Step 7.1: Configure the Cloud Backend Target
1. In the project folder on your local computer, open the file:
   `.env.production` (or create one if it doesn't exist).
2. Set the `VITE_API_BASE_URL` to your Railway domain:
   ```env
   VITE_API_BASE_URL=https://your-api.up.railway.app
   ```

---

### Step 7.2: Build the Windows Installer (`setup.exe`)
1. Open PowerShell in the project directory:
   ```powershell
   cd "C:\Users\GSL IT\Desktop\kfd\kfd hybrid"
   ```
2. Run the automated desktop packaging command:
   ```powershell
   npm run electron:dist
   ```
3. What this command does:
   - Builds the production React client bundle into `dist/`.
   - Bundles the local backend into `dist/server.js`.
   - Invokes `electron-builder` using the rules in [`electron-builder.json`](file:///electron-builder.json).
   - Generates two production Windows binaries in the `release/` folder:
     1. **`KIID FROM DREAM POS Setup 2.4.0.exe`**: Standard NSIS Windows installer (creates desktop and start menu shortcuts).
     2. **`KIID FROM DREAM POS 2.4.0.exe`**: Portable executable (runs directly off a USB drive without installation).

---

### Step 7.3: Test Offline Sales & Auto-Sync Loop
1. Run the generated installer on your cashier PC.
2. Launch the desktop app from the desktop shortcut.
3. **Simulate an Internet Outage**:
   - Turn off Wi-Fi or unplug the Ethernet cable on your computer.
   - Ring up a sale on the desktop app.
   - Notice that the checkout succeeds instantly!
   - Look at the top sync pill: it will show **Offline** with `1 Pending Outbox Item` saved safely in local IndexedDB.
4. **Restore Internet Connection**:
   - Turn Wi-Fi back on.
   - Within 15 seconds, the Outbox engine pushes the queued transaction to your Railway backend.
   - The sync pill will turn green: **Synced**.
   - Check your Supabase database: the sale made while offline is now recorded in the cloud!

---

## 🛠️ Troubleshooting & FAQ

### Q1: My Railway deployment shows `502 Bad Gateway` or `Application Failed to Respond`.
- **Cause**: The server is listening on `127.0.0.1` instead of `0.0.0.0`.
- **Solution**: Ensure the `HOST` environment variable in Railway is set to `0.0.0.0`, and that `PORT` is set to `3000`.

### Q2: Supabase connection fails with `self-signed certificate in certificate chain` or `SSL connection error`.
- **Cause**: Cloud providers require SSL for PostgreSQL connections.
- **Solution**: Our `server/db/postgres.ts` automatically passes `ssl: { rejectUnauthorized: false }`. Ensure you are using the **Connection Pooler URL (Port 6543)** from Supabase rather than a direct IPv6 connection.

### Q3: Vercel shows `404 Not Found` when I refresh the page on `/admin` or `/inventory`.
- **Cause**: The web server is looking for a physical file instead of letting React Router handle the URL.
- **Solution**: Ensure [`vercel.json`](file:///vercel.json) exists in the root of your project with `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`.

### Q4: Cross-Origin Request Blocked (CORS error in browser console).
- **Cause**: The browser is blocking requests from your Vercel URL to your Railway URL.
- **Solution**: In Railway Variables, set `CORS_ORIGIN` to your exact Vercel URL (e.g. `https://your-app.vercel.app`) without trailing slashes.

---

### 🏁 Summary of Live Deployment URLs

Keep a record of your active cloud endpoints:
- **Supabase Dashboard**: `https://supabase.com/dashboard/project/<your-project-id>`
- **Railway Backend API**: `https://<your-service>.up.railway.app`
- **Vercel Frontend Dashboard**: `https://<your-app>.vercel.app`
- **Cashier Terminal Installer**: `release/KIID FROM DREAM POS Setup 2.4.0.exe`
