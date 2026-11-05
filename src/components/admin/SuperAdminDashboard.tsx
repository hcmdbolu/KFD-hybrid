import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  GitBranch,
  ShieldCheck,
  Plus,
  RefreshCw,
  Search,
  Power,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  MapPin,
  Phone,
  User,
  ExternalLink,
  Lock,
  Unlock,
  Store,
  Sparkles,
} from 'lucide-react';
import { usePos } from '../../context/PosContext';
import { TenantConfig, BranchConfig } from '../../types';
import { getApiUrl } from '../../utils/apiClient';

interface SuperAdminDashboardProps {
  onOpenNewBusinessModal?: () => void;
  onInspectStore?: (storeId: string, branchId?: string) => void;
}

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({
  onOpenNewBusinessModal,
  onInspectStore,
}) => {
  const {
    currentStoreId,
    setCurrentStoreId,
    currentBranchId,
    setCurrentBranchId,
    forceSync,
    triggerOutboxFlush,
    addAuditLog,
  } = usePos();

  const [tenants, setTenants] = useState<TenantConfig[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DEACTIVATED'>('ALL');
  const [expandedStores, setExpandedStores] = useState<Record<string, boolean>>({});
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Add Branch inline form state per store
  const [addingBranchForStore, setAddingBranchForStore] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string>('');
  const [branchAddress, setBranchAddress] = useState<string>('');
  const [branchPhone, setBranchPhone] = useState<string>('');
  const [branchManager, setBranchManager] = useState<string>('');

  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const token = localStorage.getItem('smartsales_auth_token_v2');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-session-token'] = token;
      }
    } catch {}
    return headers;
  }, []);

  const fetchTenants = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/v1/tenants'), { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.tenants)) {
          setTenants(data.tenants);
        }
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to load registered stores.' });
    } finally {
      setIsLoading(false);
    }
  }, [getHeaders]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback(prev => (prev?.message === message ? null : prev));
    }, 4500);
  };

  const handleToggleStoreStatus = async (tenant: TenantConfig) => {
    const nextStatus = tenant.status === 'DEACTIVATED' || tenant.status === 'SUSPENDED' ? 'ACTIVE' : 'DEACTIVATED';
    const busyKey = `status:${tenant.store_id}`;
    setActionBusyKey(busyKey);
    try {
      const res = await fetch(getApiUrl(`/api/v1/tenants/${encodeURIComponent(tenant.store_id)}/status`), {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update store status');
      }
      setTenants(prev => prev.map(t => (t.store_id === tenant.store_id ? data.tenant : t)));
      addAuditLog({
        category: 'Security',
        action: 'STAFF_UPDATED',
        details: `Super Admin changed store "${tenant.business_name}" (${tenant.store_id}) status to ${nextStatus}.`,
        severity: nextStatus === 'DEACTIVATED' ? 'WARNING' : 'INFO',
      });
      showToast('success', `${tenant.business_name} is now ${nextStatus}.`);
    } catch (err: any) {
      showToast('error', err.message || 'Could not update store status.');
    } finally {
      setActionBusyKey(null);
    }
  };

  const handleToggleBranchPermission = async (tenant: TenantConfig) => {
    const nextAllowed = !tenant.can_create_branches;
    const busyKey = `perm:${tenant.store_id}`;
    setActionBusyKey(busyKey);
    try {
      const res = await fetch(getApiUrl(`/api/v1/tenants/${encodeURIComponent(tenant.store_id)}/permissions`), {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ can_create_branches: nextAllowed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update branch creation permission');
      }
      setTenants(prev => prev.map(t => (t.store_id === tenant.store_id ? data.tenant : t)));
      addAuditLog({
        category: 'Security',
        action: 'STAFF_UPDATED',
        details: `Super Admin ${nextAllowed ? 'GRANTED' : 'REVOKED'} branch creation permission for "${tenant.business_name}" (${tenant.store_id}).`,
        severity: 'INFO',
      });
      showToast(
        'success',
        `Branch creation permission ${nextAllowed ? 'granted to' : 'revoked from'} ${tenant.business_name}.`
      );
    } catch (err: any) {
      showToast('error', err.message || 'Could not update branch permission.');
    } finally {
      setActionBusyKey(null);
    }
  };

  const handleToggleBranchStatus = async (storeId: string, branch: BranchConfig) => {
    const nextStatus = branch.status === 'DEACTIVATED' ? 'ACTIVE' : 'DEACTIVATED';
    const busyKey = `branch:${branch.branch_id}`;
    setActionBusyKey(busyKey);
    try {
      const res = await fetch(
        getApiUrl(`/api/v1/tenants/${encodeURIComponent(storeId)}/branches/${encodeURIComponent(branch.branch_id)}/status`),
        {
          method: 'PATCH',
          headers: getHeaders(),
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update branch status');
      }
      if (data.tenant) {
        setTenants(prev => prev.map(t => (t.store_id === storeId ? data.tenant : t)));
      } else {
        await fetchTenants();
      }
      showToast('success', `Branch "${branch.name}" is now ${nextStatus}.`);
    } catch (err: any) {
      showToast('error', err.message || 'Could not update branch status.');
    } finally {
      setActionBusyKey(null);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent, storeId: string) => {
    e.preventDefault();
    if (!branchName.trim()) {
      showToast('error', 'Please enter a branch name.');
      return;
    }
    const busyKey = `create-branch:${storeId}`;
    setActionBusyKey(busyKey);
    try {
      const res = await fetch(getApiUrl(`/api/v1/tenants/${encodeURIComponent(storeId)}/branches`), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          name: branchName.trim(),
          address: branchAddress.trim(),
          phone: branchPhone.trim(),
          manager_name: branchManager.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create branch');
      }
      if (data.tenant) {
        setTenants(prev => prev.map(t => (t.store_id === storeId ? data.tenant : t)));
      } else {
        await fetchTenants();
      }
      setBranchName('');
      setBranchAddress('');
      setBranchPhone('');
      setBranchManager('');
      setAddingBranchForStore(null);
      setExpandedStores(prev => ({ ...prev, [storeId]: true }));
      showToast('success', `Branch "${data.branch?.name || branchName}" created.`);
    } catch (err: any) {
      showToast('error', err.message || 'Could not create branch.');
    } finally {
      setActionBusyKey(null);
    }
  };

  const filteredTenants = tenants.filter(t => {
    const matchesSearch =
      !searchQuery.trim() ||
      t.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.store_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.vertical || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (statusFilter === 'ACTIVE') return t.status === 'ACTIVE' || !t.status;
    if (statusFilter === 'DEACTIVATED') return t.status === 'DEACTIVATED' || t.status === 'SUSPENDED';
    return true;
  });

  const totalStores = tenants.length;
  const activeStores = tenants.filter(t => t.status === 'ACTIVE' || !t.status).length;
  const deactivatedStores = tenants.filter(t => t.status === 'DEACTIVATED' || t.status === 'SUSPENDED').length;
  const totalBranches = tenants.reduce((sum, t) => sum + (Array.isArray(t.branches) ? t.branches.length : 1), 0);
  const branchPermittedStores = tenants.filter(t => t.can_create_branches).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Executive Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950 border border-slate-800 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold uppercase tracking-wider mb-3">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>SmartSales Cloud SaaS • Master Super Admin</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Multi-Tenant Store & Branch Governance
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1.5 max-w-2xl">
              Manage all registered businesses on the SmartSales platform, control branch creation rights, and activate or deactivate stores and individual branches in real time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={fetchTenants}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center gap-2 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
              <span>Refresh Directory</span>
            </button>

            {onOpenNewBusinessModal && (
              <button
                type="button"
                onClick={onOpenNewBusinessModal}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-black text-xs shadow-lg shadow-emerald-950/50 flex items-center gap-2 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Register New Store</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between text-xs font-semibold animate-fadeIn ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-500 hover:text-slate-800 font-bold px-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
            <span>Registered Stores</span>
            <Building2 className="w-4 h-4 text-slate-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1.5">{totalStores}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Multi-tenant businesses</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-emerald-200/80 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-semibold">
            <span>Active Stores</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-1.5">{activeStores}</div>
          <div className="text-[11px] text-emerald-600/80 mt-0.5">Authorized for POS operations</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-rose-200/80 shadow-xs">
          <div className="flex items-center justify-between text-rose-700 text-xs font-semibold">
            <span>Deactivated Stores</span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-black text-rose-700 mt-1.5">{deactivatedStores}</div>
          <div className="text-[11px] text-rose-600/80 mt-0.5">Login & sync suspended</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-cyan-200/80 shadow-xs">
          <div className="flex items-center justify-between text-cyan-700 text-xs font-semibold">
            <span>Total Branches</span>
            <GitBranch className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="text-2xl font-black text-cyan-700 mt-1.5">{totalBranches}</div>
          <div className="text-[11px] text-cyan-600/80 mt-0.5">Across all tenant stores</div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-indigo-200/80 shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-indigo-700 text-xs font-semibold">
            <span>Branch-Enabled</span>
            <Sparkles className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-black text-indigo-700 mt-1.5">{branchPermittedStores}</div>
          <div className="text-[11px] text-indigo-600/80 mt-0.5">Can self-create branches</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search stores by business name, store_id, or vertical..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold">
          {(['ALL', 'ACTIVE', 'DEACTIVATED'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                statusFilter === f
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {f === 'ALL' ? 'All Stores' : f === 'ACTIVE' ? 'Active Only' : 'Deactivated'}
            </button>
          ))}
        </div>
      </div>

      {/* Stores & Branches Directory List */}
      <div className="space-y-4">
        {isLoading && tenants.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
            Loading registered SmartSales stores and branches...
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <Store className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-800">No stores match your filter</h3>
            <p className="text-xs text-slate-500 mt-1">
              Try clearing your search query or register a new store using the button above.
            </p>
          </div>
        ) : (
          filteredTenants.map(tenant => {
            const isDeactivated = tenant.status === 'DEACTIVATED' || tenant.status === 'SUSPENDED';
            const branches: BranchConfig[] = Array.isArray(tenant.branches) && tenant.branches.length > 0
              ? tenant.branches
              : [
                  {
                    branch_id: tenant.store_id === 'store_default' ? 'branch_main' : `branch_${tenant.store_id}_main`,
                    store_id: tenant.store_id,
                    name: 'Main Branch (Headquarters)',
                    address: tenant.address || '',
                    phone: tenant.phone || '',
                    is_main_branch: true,
                    status: isDeactivated ? 'DEACTIVATED' : 'ACTIVE',
                    created_at: tenant.created_at,
                  },
                ];
            const isExpanded = expandedStores[tenant.store_id] ?? true;
            const isCurrentWorkspace = currentStoreId === tenant.store_id;

            return (
              <div
                key={tenant.store_id}
                className={`bg-white rounded-2xl border transition-all shadow-xs overflow-hidden ${
                  isDeactivated
                    ? 'border-rose-200/90 bg-rose-50/10'
                    : isCurrentWorkspace
                      ? 'border-emerald-500/60 ring-1 ring-emerald-500/20'
                      : 'border-slate-200/90'
                }`}
              >
                {/* Store Primary Header Bar */}
                <div className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 font-black text-base ${
                        isDeactivated
                          ? 'bg-rose-100 text-rose-700 border border-rose-200'
                          : 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
                      }`}
                    >
                      <Building2 className="w-6 h-6" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-black text-slate-900 truncate">
                          {tenant.business_name}
                        </h2>

                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                            isDeactivated
                              ? 'bg-rose-100 text-rose-800 border-rose-300'
                              : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          }`}
                        >
                          {isDeactivated ? 'DEACTIVATED' : 'ACTIVE'}
                        </span>

                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-mono text-[10px] font-bold">
                          {tenant.vertical || 'GENERAL_RETAIL'}
                        </span>

                        {isCurrentWorkspace && (
                          <span className="px-2 py-0.5 rounded-md bg-cyan-50 text-cyan-700 border border-cyan-200 text-[10px] font-bold">
                            Current Context
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1.5">
                        <span className="font-mono text-[11px] text-slate-600 font-semibold">
                          ID: {tenant.store_id}
                        </span>
                        {(tenant.address) && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            <span>{tenant.address}</span>
                          </span>
                        )}
                        {(tenant.phone) && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            <span>{tenant.phone}</span>
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-cyan-700 font-semibold">
                          <GitBranch className="w-3.5 h-3.5" />
                          <span>
                            {branches.length} {branches.length === 1 ? 'Branch' : 'Branches'}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Store Governance Controls */}
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    {/* Grant / Revoke Branch Creation Toggle */}
                    <button
                      type="button"
                      disabled={actionBusyKey === `perm:${tenant.store_id}`}
                      onClick={() => handleToggleBranchPermission(tenant)}
                      className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                        tenant.can_create_branches
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-800 hover:bg-indigo-100'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                      title="Grant or revoke permission for this store to create its own branches"
                    >
                      {tenant.can_create_branches ? (
                        <Unlock className="w-3.5 h-3.5 text-indigo-600" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span>
                        Branch Creation: {tenant.can_create_branches ? 'Allowed' : 'Restricted'}
                      </span>
                    </button>

                    {/* Activate / Deactivate Store Button */}
                    <button
                      type="button"
                      disabled={actionBusyKey === `status:${tenant.store_id}`}
                      onClick={() => handleToggleStoreStatus(tenant)}
                      className={`px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        isDeactivated
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600 shadow-xs'
                          : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{isDeactivated ? 'Reactivate Store' : 'Deactivate Store'}</span>
                    </button>

                    {/* Inspect / Switch Context Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentStoreId(tenant.store_id);
                        if (branches[0]?.branch_id) {
                          setCurrentBranchId(branches[0].branch_id);
                        }
                        triggerOutboxFlush();
                        forceSync();
                        if (onInspectStore) {
                          onInspectStore(tenant.store_id, branches[0]?.branch_id);
                        }
                        showToast('success', `Switched active workspace to ${tenant.business_name}`);
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Inspect Store</span>
                    </button>

                    {/* Expand / Collapse Branches */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedStores(prev => ({
                          ...prev,
                          [tenant.store_id]: !isExpanded,
                        }))
                      }
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                      title={isExpanded ? 'Hide Branches' : 'Show Branches'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expandable Branches Panel */}
                {isExpanded && (
                  <div className="bg-slate-50/90 border-t border-slate-200/80 px-5 py-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
                        <GitBranch className="w-3.5 h-3.5 text-cyan-600" />
                        <span>Store Branches ({branches.length})</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (addingBranchForStore === tenant.store_id) {
                            setAddingBranchForStore(null);
                          } else {
                            setAddingBranchForStore(tenant.store_id);
                            setBranchName('');
                            setBranchAddress('');
                            setBranchPhone('');
                            setBranchManager('');
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Branch</span>
                      </button>
                    </div>

                    {/* Inline Add Branch Form */}
                    {addingBranchForStore === tenant.store_id && (
                      <form
                        onSubmit={e => handleCreateBranch(e, tenant.store_id)}
                        className="bg-white border border-cyan-200 rounded-xl p-4 space-y-3 shadow-xs animate-fadeIn"
                      >
                        <div className="text-xs font-bold text-slate-800 flex items-center justify-between">
                          <span>Create New Branch for {tenant.business_name}</span>
                          <button
                            type="button"
                            onClick={() => setAddingBranchForStore(null)}
                            className="text-slate-400 hover:text-slate-700"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Branch Name *
                            </label>
                            <input
                              type="text"
                              required
                              value={branchName}
                              onChange={e => setBranchName(e.target.value)}
                              placeholder="e.g. Ikeja Mall Branch"
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Branch Address
                            </label>
                            <input
                              type="text"
                              value={branchAddress}
                              onChange={e => setBranchAddress(e.target.value)}
                              placeholder="Street & City"
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Branch Phone
                            </label>
                            <input
                              type="text"
                              value={branchPhone}
                              onChange={e => setBranchPhone(e.target.value)}
                              placeholder="+234..."
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              Branch Manager
                            </label>
                            <input
                              type="text"
                              value={branchManager}
                              onChange={e => setBranchManager(e.target.value)}
                              placeholder="Manager Name"
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-cyan-500"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setAddingBranchForStore(null)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={actionBusyKey === `create-branch:${tenant.store_id}`}
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs"
                          >
                            {actionBusyKey === `create-branch:${tenant.store_id}`
                              ? 'Creating...'
                              : 'Save Branch'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Branches Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {branches.map(branch => {
                        const isBranchDeactivated = branch.status === 'DEACTIVATED';
                        const isSelectedBranch =
                          isCurrentWorkspace && currentBranchId === branch.branch_id;

                        return (
                          <div
                            key={branch.branch_id}
                            className={`p-3.5 rounded-xl border bg-white flex items-center justify-between gap-3 ${
                              isBranchDeactivated
                                ? 'border-rose-200 bg-rose-50/30'
                                : isSelectedBranch
                                  ? 'border-cyan-500/60 ring-1 ring-cyan-500/20'
                                  : 'border-slate-200/80'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-900 truncate">
                                  {branch.name}
                                </span>
                                {branch.is_main_branch && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                                    HQ
                                  </span>
                                )}
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    isBranchDeactivated
                                      ? 'bg-rose-100 text-rose-700'
                                      : 'bg-emerald-100 text-emerald-700'
                                  }`}
                                >
                                  {isBranchDeactivated ? 'DEACTIVATED' : 'ACTIVE'}
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                                {branch.branch_id}
                              </div>

                              {(branch.address || branch.manager_name) && (
                                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 mt-1">
                                  {branch.address && (
                                    <span className="inline-flex items-center gap-1">
                                      <MapPin className="w-3 h-3 text-slate-400" />
                                      <span>{branch.address}</span>
                                    </span>
                                  )}
                                  {branch.manager_name && (
                                    <span className="inline-flex items-center gap-1">
                                      <User className="w-3 h-3 text-slate-400" />
                                      <span>{branch.manager_name}</span>
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={actionBusyKey === `branch:${branch.branch_id}`}
                                onClick={() => handleToggleBranchStatus(tenant.store_id, branch)}
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                                  isBranchDeactivated
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600'
                                    : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                                }`}
                              >
                                {isBranchDeactivated ? 'Activate' : 'Deactivate'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
