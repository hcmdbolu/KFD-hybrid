import React, { useState, useEffect, useRef } from 'react';
import { usePos } from '../context/PosContext';
import { 
  Menu, 
  Clock, 
  AlertTriangle, 
  RefreshCw, 
  Radio, 
  LockKeyhole,
  PanelLeftOpen,
  PanelLeftClose,
  LayoutDashboard,
  ShoppingCart,
  Building2,
  Plus,
  ChevronDown,
  Check,
  Cloud,
  CloudOff,
  FileText
} from 'lucide-react';
import { ROLE_BADGES } from '../utils/rbac';
import { TenantConfig } from '../types';
import { getApiUrl } from '../utils/apiClient';

interface AppHeaderProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  sidebarHidden?: boolean;
  onToggleSidebar?: () => void;
  onToggleMobileMenu: () => void;
  onOpenNewBusinessModal?: () => void;
  onOpenZReportModal?: () => void;
}

const TAB_TITLES: Record<string, { title: string; subtitle: string }> = {
  saas_admin: {
    title: 'SmartSales SaaS Super Admin Control Center',
    subtitle: 'Global multi-tenant store directory, branch creation permissions, and store/branch activation governance.',
  },
  pos: {
    title: 'POS Sales Terminal',
    subtitle: 'High-speed counter transactions, weight scale adjustments, and split tender settlements.',
  },
  inventory: {
    title: 'Inventory & Stock Management',
    subtitle: 'Real-time inventory levels, batch expiries, reorder thresholds, and cycle counts.',
  },
  sales: {
    title: 'Sales History & Void Ledger',
    subtitle: 'Immutable counter transaction logs, customer returns, and aborted order audit records.',
  },
  customers: {
    title: 'Customer Directory & VIP Rates',
    subtitle: 'Wholesale, restaurant, and retail customer database with authorized custom discount rates.',
  },
  suppliers: {
    title: 'Suppliers & Purchase Orders',
    subtitle: 'Vendors, suppliers, receiving goods inspections, and supply chain tracking.',
  },
  reports: {
    title: 'Executive Financial & P&L Reports',
    subtitle: 'Gross revenue, margins, COGS, payment breakdown, and cashier shift balance reconciliation.',
  },
  audit: {
    title: 'Cryptographic Audit Trail Ledger',
    subtitle: 'SHA-256 tamper-evident system logs, security overrides, and operational event history.',
  },
  treasury: {
    title: 'Cash Drawer & Treasury / Bank Management',
    subtitle: 'Unified cash till management, bank accounts, wireless POS terminals, and bidirectional fund transfers.',
  },
  reconciliation: {
    title: 'Cash Drawer Reconciliation & Bank Treasury',
    subtitle: 'Track physical till cash balances per cashier, shift collections, and authorize bank deposits.',
  },
  pos_setup: {
    title: 'POS Terminal Setup & Bank Account Mapping',
    subtitle: 'Configure wireless POS machines (Moniepoint, OPay, GTBank) and commercial accounts for sale tagging.',
  },
  staff: {
    title: 'Staff & Role Security Administration',
    subtitle: 'Standard enterprise RBAC, staff credentials, security PINs, and shift scheduling.',
  },
  cycle_count: {
    title: 'Physical Stock Cycle Count & Variance Audit',
    subtitle: 'Periodic physical inventory auditing, scale calibration, and immediate stock reconciliation ledger.',
  },
  receipt_settings: {
    title: 'Receipt & Branding Customization',
    subtitle: 'Configure store logo, contact info, thermal roll width, tax registration, and customer return policies.',
  },
};

export const AppHeader: React.FC<AppHeaderProps> = ({
  currentTab,
  setCurrentTab,
  sidebarHidden = false,
  onToggleSidebar,
  onToggleMobileMenu,
  onOpenNewBusinessModal,
  onOpenZReportModal,
}) => {
  const { 
    activeStaff, 
    lowStockCount, 
    expiringSoonCount, 
    currentStoreId,
    setCurrentStoreId,
    currentBranchId,
    setCurrentBranchId,
    syncEngineStatus,
    triggerOutboxFlush,
    forceSync,
    receiptSettings,
    recentBroadcastNotice,
    clearBroadcastNotice,
    lockTerminal,
    openLoginModal
  } = usePos();

  const [currentTime, setCurrentTime] = useState<string>('');
  const [isStoreDropdownOpen, setIsStoreDropdownOpen] = useState(false);
  const [tenantsList, setTenantsList] = useState<TenantConfig[]>([]);
  const [newBranchName, setNewBranchName] = useState('');
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isCashier = activeStaff.role === 'Cashier';

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch tenants list for switcher dropdown
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const res = await fetch(getApiUrl('/api/v1/tenants'));
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.tenants)) {
            setTenantsList(data.tenants);
          }
        }
      } catch (err) {
        console.warn('Failed to load tenants list:', err);
      }
    };
    fetchTenants();
  }, [currentStoreId]);

  // Click outside listener for store dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsStoreDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const meta = TAB_TITLES[currentTab] || {
    title: 'SmartSales POS',
    subtitle: 'Retail Counter & Point of Sale Management',
  };

  const roleBadge = ROLE_BADGES[activeStaff.role] || ROLE_BADGES.Cashier;

  const currentTenantObj = tenantsList.find(t => t.store_id === currentStoreId);
  const storeDisplayName = receiptSettings?.business_name || currentTenantObj?.business_name || (currentStoreId === 'store_default' ? 'Main Store' : currentStoreId);

  return (
    <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      {/* Broadcast Banner if any */}
      {recentBroadcastNotice && (
        <div className="bg-emerald-600 text-white text-xs px-4 py-1.5 font-medium flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-2">
            <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-200" />
            <span>{recentBroadcastNotice}</span>
          </div>
          <button
            type="button"
            onClick={clearBroadcastNotice}
            className="text-emerald-200 hover:text-white text-xs font-bold px-2 py-0.5 rounded hover:bg-emerald-700/50"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Bar */}
      <div className="px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3">
        {/* Left: Sidebar Toggle Button + Module Title */}
        <div className="flex items-center space-x-3 min-w-0">
          <button
            type="button"
            onClick={onToggleSidebar || onToggleMobileMenu}
            className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center space-x-1.5 shrink-0 ${
              sidebarHidden
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-600/20 hover:bg-emerald-700'
                : 'bg-slate-100 text-slate-700 border-slate-200/80 hover:bg-slate-200'
            }`}
            title={sidebarHidden ? "Show Navigation Side Panel (Press [ or Ctrl+B)" : "Hide Navigation Side Panel"}
            aria-label="Toggle Navigation Side Panel"
          >
            {sidebarHidden ? (
              <>
                <PanelLeftOpen className="w-5 h-5" />
                <span className="text-xs font-bold hidden sm:inline">Show Side Panel</span>
              </>
            ) : (
              <>
                <PanelLeftClose className="w-5 h-5 hidden md:block" />
                <Menu className="w-5 h-5 md:hidden" />
              </>
            )}
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight truncate">
                {meta.title}
              </h1>

              {/* View Mode Switcher: POS Register vs Management Back-Office */}
              {!isCashier && (
                currentTab === 'pos' ? (
                  <button
                    type="button"
                    onClick={() => setCurrentTab('reports')}
                    className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold border border-slate-700 shadow-xs transition-all"
                    title="Switch to Management Dashboard"
                  >
                    <LayoutDashboard className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Management Dashboard</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCurrentTab('pos')}
                    className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold border border-emerald-500 shadow-xs transition-all animate-pulse"
                    title="Switch to Cashier POS Register"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>Open Register</span>
                  </button>
                )
              )}
            </div>
            <p className="text-[11px] text-slate-500 truncate hidden sm:block">
              {meta.subtitle}
            </p>
          </div>
        </div>

        {/* Right Controls: Store Selector, Sync Badge, Alerts, Staff, Screen Lock */}
        <div className="flex items-center space-x-2 text-xs shrink-0">
          {/* Active Store / Tenant Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsStoreDropdownOpen(!isStoreDropdownOpen)}
              className="flex items-center space-x-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-200 text-[11px] font-medium transition-colors"
              title="Active Business Store / Tenant"
            >
              <Building2 className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
              <span className="font-semibold max-w-[120px] truncate">{storeDisplayName}</span>
              <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
            </button>

            {isStoreDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 z-50 animate-fadeIn text-xs">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 mb-1">
                  Active Stores & Branches
                </div>
                
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {tenantsList.length === 0 ? (
                    <div
                      onClick={() => {
                        setCurrentStoreId('store_default');
                        setIsStoreDropdownOpen(false);
                      }}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-800 text-white cursor-pointer"
                    >
                      <div>
                        <div className="font-semibold">{storeDisplayName}</div>
                        <div className="text-[10px] text-cyan-400 font-mono">store_default</div>
                      </div>
                      <Check className="w-4 h-4 text-emerald-400" />
                    </div>
                  ) : (
                    tenantsList.map(t => {
                      const isCurrent = t.store_id === currentStoreId;
                      return (
                        <div
                          key={t.store_id}
                          onClick={() => {
                            setCurrentStoreId(t.store_id);
                            triggerOutboxFlush();
                            forceSync();
                            setIsStoreDropdownOpen(false);
                          }}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                            isCurrent ? 'bg-cyan-950/80 border border-cyan-500/50 text-white' : 'hover:bg-slate-800 text-slate-300'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-semibold truncate">{t.business_name}</div>
                            <div className="text-[10px] text-slate-400 font-mono truncate">
                              {t.store_id} • {t.vertical}
                            </div>
                          </div>
                          {isCurrent && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                        </div>
                      );
                    })
                  )}
                </div>

                {currentTenantObj?.branches && currentTenantObj.branches.length > 0 && (
                  <div className="mt-2 pt-1.5 border-t border-slate-800">
                    <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Branches ({currentTenantObj.business_name})
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {currentTenantObj.branches.map(b => {
                        const isBranchSelected = currentBranchId === b.branch_id;
                        return (
                          <div
                            key={b.branch_id}
                            onClick={() => {
                              if (b.status === 'DEACTIVATED' && activeStaff.role !== 'Super Admin') return;
                              setCurrentBranchId(b.branch_id);
                              setIsStoreDropdownOpen(false);
                            }}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] ${
                              b.status === 'DEACTIVATED'
                                ? 'opacity-50 cursor-not-allowed text-rose-400'
                                : isBranchSelected
                                  ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 cursor-pointer'
                                  : 'hover:bg-slate-800 text-slate-300 cursor-pointer'
                            }`}
                          >
                            <span className="truncate">{b.name}</span>
                            <span className="text-[9px] font-mono">
                              {b.status === 'DEACTIVATED' ? 'DEACTIVATED' : isBranchSelected ? 'ACTIVE' : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeStaff.role === 'Admin' && currentTenantObj?.can_create_branches && (
                  <div className="mt-2 pt-1.5 border-t border-slate-800 space-y-1.5">
                    <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      + Create Store Branch
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={newBranchName}
                        onChange={e => setNewBranchName(e.target.value)}
                        placeholder="New branch name..."
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        disabled={isCreatingBranch || !newBranchName.trim()}
                        onClick={async () => {
                          if (!newBranchName.trim()) return;
                          setIsCreatingBranch(true);
                          try {
                            const token = localStorage.getItem('smartsales_auth_token_v2') || '';
                            const res = await fetch(getApiUrl(`/api/v1/tenants/${encodeURIComponent(currentStoreId)}/branches`), {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': token ? `Bearer ${token}` : '',
                                'x-session-token': token,
                              },
                              body: JSON.stringify({ name: newBranchName.trim() }),
                            });
                            const data = await res.json();
                            if (res.ok && data.success && data.tenant) {
                              setTenantsList(prev => prev.map(t => (t.store_id === currentStoreId ? data.tenant : t)));
                              if (data.branch?.branch_id) {
                                setCurrentBranchId(data.branch.branch_id);
                              }
                              setNewBranchName('');
                            }
                          } catch {}
                          setIsCreatingBranch(false);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] disabled:opacity-40 cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}

                {activeStaff.role === 'Super Admin' && (
                  <div className="mt-2 pt-1.5 border-t border-slate-800 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsStoreDropdownOpen(false);
                        setCurrentTab('saas_admin');
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] shadow-sm transition-all cursor-pointer"
                    >
                      <LayoutDashboard className="w-3.5 h-3.5" />
                      <span>Open Super Admin Control Center</span>
                    </button>
                    {onOpenNewBusinessModal && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsStoreDropdownOpen(false);
                          onOpenNewBusinessModal();
                        }}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-[11px] shadow-sm transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Register New Store</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Hybrid Offline-First Sync Pill */}
          <div 
            className="flex items-center space-x-1.5 bg-slate-100 text-slate-700 px-2.5 py-1.5 rounded-xl border border-slate-200 text-[11px] font-mono cursor-pointer hover:bg-slate-200/80 transition-colors"
            onClick={() => triggerOutboxFlush()}
            title={
              syncEngineStatus.isSyncing 
                ? 'Syncing local outbox mutations to server...'
                : !syncEngineStatus.isOnline 
                  ? `Offline Mode: ${syncEngineStatus.pendingCount} local transactions queued in outbox. Click to retry.`
                  : syncEngineStatus.pendingCount > 0
                    ? `${syncEngineStatus.pendingCount} queued outbox mutations. Click to flush sync now.`
                    : `Central DB Synced (v${syncEngineStatus.lastServerVersion}). Click to force delta pull.`
            }
          >
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                !syncEngineStatus.isOnline 
                  ? 'bg-rose-400' 
                  : syncEngineStatus.isSyncing 
                    ? 'bg-blue-400' 
                    : syncEngineStatus.pendingCount > 0 
                      ? 'bg-amber-400' 
                      : 'bg-emerald-400'
              }`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${
                !syncEngineStatus.isOnline 
                  ? 'bg-rose-500' 
                  : syncEngineStatus.isSyncing 
                    ? 'bg-blue-500' 
                    : syncEngineStatus.pendingCount > 0 
                      ? 'bg-amber-500' 
                      : 'bg-emerald-500'
              }`} />
            </span>

            {syncEngineStatus.isOnline ? (
              <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : (
              <CloudOff className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            )}

            <span className="font-semibold text-slate-800 hidden sm:inline">
              {syncEngineStatus.isSyncing 
                ? 'Syncing' 
                : !syncEngineStatus.isOnline 
                  ? `Offline${syncEngineStatus.pendingCount > 0 ? ` (${syncEngineStatus.pendingCount})` : ''}` 
                  : syncEngineStatus.pendingCount > 0 
                    ? `Pending (${syncEngineStatus.pendingCount})` 
                    : 'Synced'}
            </span>

            <RefreshCw className={`w-3 h-3 text-slate-500 ${syncEngineStatus.isSyncing ? 'animate-spin text-cyan-600' : ''}`} />
          </div>

          {/* End-of-Day Z-Report Quick Button (Manager / Admin / Super Admin) */}
          {['Manager', 'Admin', 'Super Admin'].includes(activeStaff.role) && onOpenZReportModal && (
            <button
              type="button"
              onClick={onOpenZReportModal}
              className="hidden md:flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1.5 rounded-xl border border-slate-700 text-[11px] font-bold transition-colors cursor-pointer"
              title="Generate End-of-Day Z-Report & WhatsApp/Email Digest"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              <span>Z-Report</span>
            </button>
          )}

          {/* Live Clock */}
          <div className="hidden xl:flex items-center space-x-1.5 text-slate-600 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200/80 font-mono text-[11px]">
            <Clock className="w-3.5 h-3.5 text-emerald-600" />
            <span>{currentTime || '25 Sep 2026'}</span>
          </div>

          {/* Low Stock Alerts */}
          {(lowStockCount > 0 || expiringSoonCount > 0) && (
            <button
              type="button"
              onClick={() => {
                if (['Supervisor', 'Manager', 'Admin'].includes(activeStaff.role)) {
                  setCurrentTab('inventory');
                }
              }}
              className="flex items-center space-x-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer"
              title={`${lowStockCount} items low in stock, ${expiringSoonCount} expiring soon`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
              <span className="font-bold">{lowStockCount + expiringSoonCount} Alerts</span>
            </button>
          )}

          {/* Quick Staff Switch Button */}
          <button
            type="button"
            onClick={() => openLoginModal('SWITCH')}
            className="flex items-center space-x-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs transition-colors cursor-pointer"
            title="Switch Operator"
          >
            <div className="w-5 h-5 rounded-md bg-slate-900 text-emerald-400 font-mono font-bold text-[10px] flex items-center justify-center">
              {activeStaff.staff_name[0]}
            </div>
            <span className="font-semibold text-slate-800 hidden md:inline">{activeStaff.staff_name}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${roleBadge.bg} ${roleBadge.text} ${roleBadge.border}`}>
              {roleBadge.label}
            </span>
          </button>

          {/* Lock Terminal Button */}
          <button
            type="button"
            onClick={lockTerminal}
            className="p-2 bg-slate-100 hover:bg-amber-100 text-slate-600 hover:text-amber-800 border border-slate-200 rounded-xl transition-colors cursor-pointer"
            title="Lock POS Terminal Screen"
          >
            <LockKeyhole className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
