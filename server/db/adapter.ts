export interface DatabaseMetadata {
  version: number;
  lastUpdated: string;
}

export interface IPosDatabase {
  getMetadata(): DatabaseMetadata | Promise<DatabaseMetadata>;
  touchVersion(): number | Promise<number>;
  getTable(table: string, storeId?: string): any[] | Promise<any[]>;
  getById<T = any>(table: string, idField: string, idVal: any, storeId?: string): T | null | Promise<T | null>;
  upsertProduct(product: any, storeId?: string): void | Promise<void>;
  deleteProduct(itemSn: string, storeId?: string): void | Promise<void>;
  upsertCustomer(customer: any, storeId?: string): void | Promise<void>;
  deleteCustomer(customerId: string, storeId?: string): void | Promise<void>;
  upsertSupplier(supplier: any, storeId?: string): void | Promise<void>;
  deleteSupplier(supplierId: string, storeId?: string): void | Promise<void>;
  upsertEmployee(employee: any, storeId?: string): void | Promise<void>;
  deleteEmployee(staffId: string, storeId?: string): void | Promise<void>;
  addSale(sale: any, storeId?: string): void | Promise<void>;
  addRefund(refund: any, storeId?: string): void | Promise<void>;
  addAuditLog(auditLog: any, storeId?: string): void | Promise<void>;
  addCycleCount(cycleCount: any, storeId?: string): void | Promise<void>;
  addStockTransfer(transfer: any, storeId?: string): void | Promise<void>;
  addParkedOrder(order: any, storeId?: string): void | Promise<void>;
  deleteParkedOrder(id: string, storeId?: string): void | Promise<void>;
  addVoidedOrder(order: any, storeId?: string): void | Promise<void>;
  upsertPosTerminal(terminal: any, storeId?: string): void | Promise<void>;
  deletePosTerminal(id: string, storeId?: string): void | Promise<void>;
  addCashTransfer(transfer: any, storeId?: string): void | Promise<void>;
  addCustomerDebtRepayment(repayment: any, storeId?: string): void | Promise<void>;
  getCustomerDebtRepayments(storeId?: string): any[] | Promise<any[]>;
  getReceiptSettings(storeId?: string): any | Promise<any>;
  upsertReceiptSettings(settings: any, storeId?: string): void | Promise<void>;
  getDiscountSecurityConfig(storeId?: string): any | Promise<any>;
  upsertDiscountSecurityConfig(config: any, storeId?: string): void | Promise<void>;
  getCategories(storeId?: string): any[] | Promise<any[]>;
  upsertCategory(category: any, storeId?: string): void | Promise<void>;
  deleteCategory(id: string, storeId?: string): void | Promise<void>;
  getDiscountRules(storeId?: string): any[] | Promise<any[]>;
  upsertDiscountRule(rule: any, storeId?: string): void | Promise<void>;
  deleteDiscountRule(ruleId: string, storeId?: string): void | Promise<void>;
  registerTenant(params: {
    business_name: string;
    vertical?: string;
    currency?: string;
    phone?: string;
    email?: string;
    address?: string;
    admin_name?: string;
    admin_username?: string;
    admin_pin?: string;
    can_create_branches?: boolean;
  }): any | Promise<any>;
  listTenants(): any[] | Promise<any[]>;
  getTenant(storeId: string): any | null | Promise<any | null>;
  updateTenantStatus(storeId: string, status: 'ACTIVE' | 'DEACTIVATED'): any | Promise<any>;
  updateTenantPermissions(storeId: string, canCreateBranches: boolean): any | Promise<any>;
  listBranches(storeId?: string): any[] | Promise<any[]>;
  createBranch(params: {
    store_id: string;
    name: string;
    address?: string;
    phone?: string;
    manager_name?: string;
    is_main_branch?: boolean;
  }): any | Promise<any>;
  updateBranchStatus(storeId: string, branchId: string, status: 'ACTIVE' | 'DEACTIVATED'): any | Promise<any>;
  processSyncPush(params: {
    store_id: string;
    terminal_id: string;
    events: any[];
  }): {
    success: boolean;
    processed_event_ids: string[];
    rejected_event_ids: Array<{ event_id: string; reason: string }>;
    server_version: number;
    synced_at: string;
  } | Promise<{
    success: boolean;
    processed_event_ids: string[];
    rejected_event_ids: Array<{ event_id: string; reason: string }>;
    server_version: number;
    synced_at: string;
  }>;
  getSyncDeltas(storeId?: string, sinceVersion?: number): {
    success: boolean;
    up_to_date: boolean;
    current_version: number;
    deltas?: any;
  } | Promise<{
    success: boolean;
    up_to_date: boolean;
    current_version: number;
    deltas?: any;
  }>;
  recordTerminalHeartbeat(params: {
    terminal_id: string;
    store_id: string;
    terminal_name?: string;
    app_version?: string;
    ip_address?: string;
    pending_outbox_count?: number;
  }): any | Promise<any>;
  setTerminalLockState(
    terminalId: string,
    storeId: string,
    isLocked: boolean,
    reason?: string
  ): any | Promise<any>;
  getFleetTerminals(storeId?: string): any[] | Promise<any[]>;
  getSnapshot(storeId?: string): any | Promise<any>;
}
