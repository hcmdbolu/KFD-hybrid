import React, { useState, useEffect, Suspense, lazy } from 'react';
import { PosProvider, usePos } from './context/PosContext';
import { Sidebar } from './components/Sidebar';
import { AppHeader } from './components/AppHeader';
import { PosTerminal } from './components/pos/PosTerminal';
import { SalesHistoryManager } from './components/sales/SalesHistoryManager';
import { ReceiptModal } from './components/receipt/ReceiptModal';
import { RefundModal } from './components/refund/RefundModal';
import { LoginAuthModal } from './components/auth/LoginAuthModal';
import { StaffManagerModal } from './components/admin/StaffManagerModal';
import { FactoryResetModal } from './components/admin/FactoryResetModal';
import { BackupRestoreModal } from './components/admin/BackupRestoreModal';
import { BusinessOnboardingModal } from './components/auth/BusinessOnboardingModal';
import { CycleCountModal } from './components/inventory/CycleCountModal';
import { StockTransferModal } from './components/inventory/StockTransferModal';
import { ZReportModal } from './components/reports/ZReportModal';

// Code-Split Back-Office & SaaS Governance Modules
const SuperAdminDashboard = lazy(() => import('./components/admin/SuperAdminDashboard').then(m => ({ default: m.SuperAdminDashboard })));
const InventoryManager = lazy(() => import('./components/inventory/InventoryManager').then(m => ({ default: m.InventoryManager })));
const CustomerManager = lazy(() => import('./components/customers/CustomerManager').then(m => ({ default: m.CustomerManager })));
const SupplierAndPOManager = lazy(() => import('./components/suppliers/SupplierAndPOManager').then(m => ({ default: m.SupplierAndPOManager })));
const ReportingDashboard = lazy(() => import('./components/reports/ReportingDashboard').then(m => ({ default: m.ReportingDashboard })));
const AuditLogManager = lazy(() => import('./components/security/AuditLogManager').then(m => ({ default: m.AuditLogManager })));
const StaffAndRolesManager = lazy(() => import('./components/admin/StaffAndRolesManager').then(m => ({ default: m.StaffAndRolesManager })));
const LegacyDataMigrationModal = lazy(() => import('./components/admin/LegacyDataMigrationModal').then(m => ({ default: m.LegacyDataMigrationModal })));
const CashDrawerTreasuryManager = lazy(() => import('./components/finance/CashDrawerTreasuryManager').then(m => ({ default: m.CashDrawerTreasuryManager })));
const CycleCountManager = lazy(() => import('./components/inventory/CycleCountManager').then(m => ({ default: m.CycleCountManager })));
const ReceiptBrandingManager = lazy(() => import('./components/admin/ReceiptBrandingManager').then(m => ({ default: m.ReceiptBrandingManager })));
const TerminalFleetManager = lazy(() => import('./components/admin/TerminalFleetManager').then(m => ({ default: m.TerminalFleetManager })));
import { SaleTransaction, UserRole } from './types';
import { PanelLeftOpen, Lock } from 'lucide-react';
import { ErrorBoundary } from './components/common/ErrorBoundary';

function MainApp() {
  const { 
    activeStaff,
    activeReceipt, 
    setActiveReceipt,
    setSelectedCustomerId,
    isAuthenticated,
    isAuthModalOpen,
    authModalMode,
    closeLoginModal,
    isBackupModalOpen,
    closeBackupModal,
    isFactoryResetModalOpen,
    closeFactoryResetModal,
    isRemoteLocked,
    remoteLockReason,
  } = usePos();

  const [currentTab, setCurrentTab] = useState<string>('pos');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [shouldOpenHeldOrders, setShouldOpenHeldOrders] = useState(false);
  
  // Persistent side panel hidden state
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('smartsales_sidebar_hidden_v1');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('smartsales_sidebar_hidden_v1', String(sidebarHidden));
    } catch {}
  }, [sidebarHidden]);

  // SuperAdmin accounts land on the SmartSales Multi-Tenant SaaS Control Center
  useEffect(() => {
    if (activeStaff.role === 'Super Admin' && currentTab === 'pos') {
      setCurrentTab('saas_admin');
    }
  }, [activeStaff.role, currentTab]);

  // Keyboard shortcut: [ or Ctrl+B to toggle side panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarHidden(prev => !prev);
      }
      if (e.key === '[') {
        e.preventDefault();
        setSidebarHidden(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleToggleSidebar = () => {
    if (window.innerWidth < 768) {
      setMobileMenuOpen(prev => !prev);
    } else {
      setSidebarHidden(prev => !prev);
    }
  };

  // Modals
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [selectedTxForRefund, setSelectedTxForRefund] = useState<SaleTransaction | null>(null);
  const [isCycleCountOpen, setIsCycleCountOpen] = useState(false);
  const [isStockTransferOpen, setIsStockTransferOpen] = useState(false);
  const [isStaffManagerOpen, setIsStaffManagerOpen] = useState(false);
  const [isNewBusinessModalOpen, setIsNewBusinessModalOpen] = useState(false);
  const [isZReportModalOpen, setIsZReportModalOpen] = useState(false);

  // Cross-navigation states
  const [prefilledPo, setPrefilledPo] = useState<{ supplierId?: string; itemSn?: string }>({});

  const handleQuickReorder = (supplierId: string, itemSn: string) => {
    setPrefilledPo({ supplierId, itemSn });
    setCurrentTab('suppliers');
  };

  const handleSelectCustomerForSale = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setCurrentTab('pos');
  };

  const handleOpenRefundForTx = (tx: SaleTransaction) => {
    if (activeStaff.role !== 'Manager' && activeStaff.role !== 'Admin') {
      return;
    }
    setSelectedTxForRefund(tx);
    setIsRefundModalOpen(true);
  };

  // STRICT ACCESS REDIRECTION:
  // "and all module other user can not access should not show at all for the user"
  // If the user's role does not allow the currentTab, immediately redirect to 'pos'
  useEffect(() => {
    const role = activeStaff.role;
    const restrictedTabsForRole: Record<UserRole, string[]> = {
      Cashier: ['saas_admin', 'inventory', 'suppliers', 'reports', 'audit', 'staff', 'treasury', 'reconciliation', 'pos_setup', 'customers', 'receipt_settings', 'fleet'],
      Supervisor: ['saas_admin', 'reports', 'audit', 'staff', 'treasury', 'reconciliation', 'pos_setup', 'receipt_settings', 'fleet'],
      Manager: ['saas_admin', 'staff'],
      Admin: ['saas_admin'],
      'Super Admin': [],
    };
    if (restrictedTabsForRole[role]?.includes(currentTab)) {
      setCurrentTab('pos');
    }
  }, [activeStaff.role, currentTab]);

  const isCashier = activeStaff.role === 'Cashier';
  const isSupervisor = activeStaff.role === 'Supervisor';

  // When not authenticated, render ONLY the login page + separated Store Registration wizard
  if (!isAuthenticated) {
    return (
      <>
        <LoginAuthModal
          isOpen={true}
          onClose={closeLoginModal}
          mode="LOGIN"
          onOpenRegisterStore={() => setIsNewBusinessModalOpen(true)}
        />
        <BusinessOnboardingModal
          isOpen={isNewBusinessModalOpen}
          onClose={() => setIsNewBusinessModalOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-100/70 text-slate-800 flex flex-col md:flex-row font-sans antialiased selection:bg-emerald-500 selection:text-white">
      {/* Side Navigation Bar (By the Sides) */}
      <Sidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        onOpenRefundModal={() => {
          if (['Manager', 'Admin', 'Super Admin'].includes(activeStaff.role)) {
            setSelectedTxForRefund(null);
            setIsRefundModalOpen(true);
          }
        }}
        onOpenCycleCount={() => setIsCycleCountOpen(true)}
        onOpenStockTransfer={() => setIsStockTransferOpen(true)}
        onOpenStaffAdmin={() => setIsStaffManagerOpen(true)}
        onOpenParkedOrders={() => {
          setCurrentTab('pos');
          setShouldOpenHeldOrders(true);
        }}
        isHidden={sidebarHidden}
        onToggleHide={() => {
          if (window.innerWidth < 768) {
            setMobileMenuOpen(false);
          } else {
            setSidebarHidden(true);
          }
        }}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden transition-all duration-300">
        {/* App Header */}
        <AppHeader
          currentTab={currentTab}
          setCurrentTab={setCurrentTab}
          sidebarHidden={sidebarHidden}
          onToggleSidebar={handleToggleSidebar}
          onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
          onOpenNewBusinessModal={() => setIsNewBusinessModalOpen(true)}
          onOpenZReportModal={() => setIsZReportModalOpen(true)}
        />

        {/* Main Tab Content */}
        <main className="flex-1 overflow-y-auto min-h-0 pb-12">
          <ErrorBoundary
            fallbackTitle="View Display Error"
            fallbackMessage="An unexpected issue occurred while rendering this module. You can return to the POS register safely."
            onReset={() => setCurrentTab('pos')}
          >
            <Suspense
              fallback={
                <div className="p-12 text-center text-slate-500 text-xs font-semibold">
                  Loading SmartSales module...
                </div>
              }
            >
            {currentTab === 'saas_admin' && activeStaff.role === 'Super Admin' && (
              <SuperAdminDashboard
                onOpenNewBusinessModal={() => setIsNewBusinessModalOpen(true)}
                onInspectStore={() => setCurrentTab('reports')}
              />
            )}

            {currentTab === 'pos' && (
              <PosTerminal
                onOpenCustomerModal={() => setCurrentTab('customers')}
                openParkedOrdersDirectly={shouldOpenHeldOrders}
                onClearOpenParkedOrdersDirectly={() => setShouldOpenHeldOrders(false)}
              />
            )}

            {currentTab === 'inventory' && !isCashier && (
              <InventoryManager
                onQuickOrderPO={handleQuickReorder}
              />
            )}

            {currentTab === 'sales' && (
              <SalesHistoryManager
                onViewReceipt={(tx) => setActiveReceipt(tx)}
                onOpenRefundForTx={handleOpenRefundForTx}
              />
            )}

            {currentTab === 'customers' && !isCashier && (
              <CustomerManager
                onSelectCustomerForSale={handleSelectCustomerForSale}
              />
            )}

            {currentTab === 'suppliers' && !isCashier && (
              <SupplierAndPOManager
                initialTab={prefilledPo.itemSn ? 'orders' : 'orders'}
                prefilledSupplierId={prefilledPo.supplierId}
                prefilledItemSn={prefilledPo.itemSn}
              />
            )}

            {currentTab === 'reports' && !isCashier && !isSupervisor && (
              <ReportingDashboard
                onQuickReorder={handleQuickReorder}
              />
            )}

            {currentTab === 'audit' && !isCashier && !isSupervisor && (
              <AuditLogManager />
            )}

            {(currentTab === 'treasury' || currentTab === 'reconciliation') && !isCashier && !isSupervisor && (
              <CashDrawerTreasuryManager initialTab="drawers" />
            )}

            {currentTab === 'pos_setup' && !isCashier && !isSupervisor && (
              <CashDrawerTreasuryManager initialTab="terminals_banks" />
            )}

            {currentTab === 'receipt_settings' && !isCashier && !isSupervisor && (
              <ReceiptBrandingManager />
            )}

            {currentTab === 'cycle_count' && !isCashier && (
              <CycleCountManager />
            )}

            {currentTab === 'staff' && !isCashier && !isSupervisor && (activeStaff.role === 'Admin' || activeStaff.role === 'Super Admin') && (
              <StaffAndRolesManager />
            )}

            {currentTab === 'fleet' && !isCashier && !isSupervisor && (
              <TerminalFleetManager />
            )}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Login Authentication Modal (for Operator Switch or Screen Lock) */}
      {isAuthModalOpen && (
        <LoginAuthModal
          isOpen={isAuthModalOpen}
          onClose={closeLoginModal}
          mode={authModalMode}
        />
      )}

      {/* Thermal Receipt Modal (Auto-triggered after checkout or viewed from sales) */}
      {activeReceipt && (
        <ReceiptModal
          transaction={activeReceipt}
          onClose={() => {
            setActiveReceipt(null);
          }}
        />
      )}

      {/* Refund / Returns Processing Modal */}
      {isRefundModalOpen && (
        <RefundModal
          initialTransaction={selectedTxForRefund}
          onClose={() => {
            setIsRefundModalOpen(false);
            setSelectedTxForRefund(null);
          }}
        />
      )}

      {/* Cycle Count Modal (Supervisor, Manager, Admin) */}
      <ErrorBoundary fallbackTitle="Cycle Count Error" fallbackMessage="Unable to render Cycle Count Modal.">
        <CycleCountModal
          isOpen={isCycleCountOpen}
          onClose={() => setIsCycleCountOpen(false)}
        />
      </ErrorBoundary>

      {/* Stock Transfer Modal (Manager, Admin) */}
      <StockTransferModal
        isOpen={isStockTransferOpen}
        onClose={() => setIsStockTransferOpen(false)}
      />

      {/* Staff & Role Admin Modal (Admin) */}
      <StaffManagerModal
        isOpen={isStaffManagerOpen}
        onClose={() => setIsStaffManagerOpen(false)}
      />

      {/* Factory Data Reset Confirmation Modal (Admin Only) */}
      <FactoryResetModal
        isOpen={isFactoryResetModalOpen}
        onClose={closeFactoryResetModal}
      />

      {/* Accessible Data Backup & Restore Modal (All Staff) */}
      <BackupRestoreModal
        isOpen={isBackupModalOpen}
        onClose={closeBackupModal}
      />

      {/* Legacy Data Migration & Third-Party Import Module */}
      <Suspense fallback={null}>
        <LegacyDataMigrationModal />
      </Suspense>

      {/* End-of-Day Z-Report & Executive Digest Modal */}
      <ZReportModal
        isOpen={isZReportModalOpen}
        onClose={() => setIsZReportModalOpen(false)}
      />

      {/* New Multi-Tenant Business Onboarding Wizard */}
      <BusinessOnboardingModal
        isOpen={isNewBusinessModalOpen}
        onClose={() => setIsNewBusinessModalOpen(false)}
      />

      {/* Remote Security Lockdown Screen */}
      {isRemoteLocked && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-6 text-center select-none animate-fadeIn">
          <div className="max-w-md w-full bg-slate-900 border border-rose-800/80 rounded-3xl p-8 shadow-2xl shadow-rose-950/60">
            <div className="w-16 h-16 rounded-2xl bg-rose-600/20 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-rose-600/20">
              <Lock className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight">TERMINAL LOCKED</h2>
            <p className="text-xs text-rose-400 font-bold uppercase tracking-widest mt-1">
              Remote Security Lockdown Active
            </p>
            <div className="my-5 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300">
              <span className="text-slate-500 block text-[10px] uppercase font-bold mb-1">Reason provided:</span>
              "{remoteLockReason || 'This terminal has been temporarily locked by store management.'}"
            </div>
            <p className="text-xs text-slate-400">
              Please contact your store manager or administrator to unlock this counter terminal.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <PosProvider>
      <MainApp />
    </PosProvider>
  );
}
