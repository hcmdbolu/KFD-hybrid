import React, { useState, useEffect, useCallback } from 'react';
import { usePos } from '../../context/PosContext';
import { FleetTerminal } from '../../types';
import { getPersistentTerminalId } from '../../utils/syncOutbox';
import {
  Monitor,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
  Database,
  AlertTriangle,
  CheckCircle2,
  Radio,
  Search,
  Filter,
  Layers,
  X,
} from 'lucide-react';

export const TerminalFleetManager: React.FC = () => {
  const { currentStoreId, fetchFleetTerminals, toggleTerminalRemoteLock, activeStaff } = usePos();
  const [terminals, setTerminals] = useState<FleetTerminal[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ONLINE' | 'OFFLINE' | 'LOCKED'>('ALL');
  const [isAutoRefresh, setIsAutoRefresh] = useState<boolean>(true);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  // Lock Modal State
  const [selectedTerminalForLock, setSelectedTerminalForLock] = useState<FleetTerminal | null>(null);
  const [lockReason, setLockReason] = useState<string>('Routine security hold / counter closed');

  const currentTerminalId = getPersistentTerminalId(currentStoreId);
  const isAuthorizedManager = ['Manager', 'Admin', 'Super Admin'].includes(activeStaff.role);

  const loadFleet = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchFleetTerminals();
      setTerminals(data);
    } catch (err) {
      console.warn('Failed to load fleet terminals:', err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchFleetTerminals]);

  useEffect(() => {
    loadFleet();
  }, [loadFleet]);

  // Auto-refresh interval
  useEffect(() => {
    if (!isAutoRefresh) return;
    const interval = setInterval(() => {
      fetchFleetTerminals().then((data) => {
        if (data && data.length) setTerminals(data);
      }).catch(() => {});
    }, 10000);

    return () => clearInterval(interval);
  }, [isAutoRefresh, fetchFleetTerminals]);

  const handleToggleLock = async (terminal: FleetTerminal) => {
    if (!isAuthorizedManager) return;

    if (terminal.is_locked) {
      // Direct Unlock
      setActiveActionId(terminal.id);
      try {
        await toggleTerminalRemoteLock(terminal.id, false);
        await loadFleet();
      } finally {
        setActiveActionId(null);
      }
    } else {
      // Open Lock Reason Modal
      setSelectedTerminalForLock(terminal);
    }
  };

  const handleConfirmLock = async () => {
    if (!selectedTerminalForLock) return;
    setActiveActionId(selectedTerminalForLock.id);
    try {
      await toggleTerminalRemoteLock(selectedTerminalForLock.id, true, lockReason.trim());
      setSelectedTerminalForLock(null);
      await loadFleet();
    } finally {
      setActiveActionId(null);
    }
  };

  // Metrics
  const totalCount = terminals.length;
  const onlineCount = terminals.filter((t) => t.is_online).length;
  const offlineCount = terminals.filter((t) => !t.is_online).length;
  const lockedCount = terminals.filter((t) => t.is_locked).length;
  const totalPendingOutbox = terminals.reduce((sum, t) => sum + (t.pending_outbox_count || 0), 0);

  // Filtered list
  const filteredTerminals = terminals.filter((t) => {
    const matchesSearch =
      (t.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.ip_address || '').includes(searchQuery);

    if (!matchesSearch) return false;

    if (statusFilter === 'ONLINE') return t.is_online;
    if (statusFilter === 'OFFLINE') return !t.is_online;
    if (statusFilter === 'LOCKED') return t.is_locked;
    return true;
  });

  const formatLastSeen = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
    if (diffSeconds < 10) return 'Just now';
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Header & Telemetry Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <h1 className="text-xl font-black text-white tracking-tight">
                POS Terminal Fleet & Remote Security
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono uppercase">
                {currentStoreId}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Real-time heartbeat monitoring, offline outbox backlog tracking, and instant remote lockdown control.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 self-end md:self-auto">
          <button
            type="button"
            onClick={() => setIsAutoRefresh(!isAutoRefresh)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 border ${
              isAutoRefresh
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Auto-refresh heartbeat telemetry every 10 seconds"
          >
            <span className={`w-2 h-2 rounded-full ${isAutoRefresh ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
            <span>Auto-Refresh (10s)</span>
          </button>

          <button
            type="button"
            onClick={loadFleet}
            disabled={isLoading}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Fleet Telemetry Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        {/* Card 1: Total Fleet */}
        <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-xl flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
            <Monitor className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Fleet</div>
            <div className="text-xl font-black text-white font-mono mt-0.5">{totalCount}</div>
          </div>
        </div>

        {/* Card 2: Online Counters */}
        <div className="bg-slate-900 border border-emerald-900/40 p-4 rounded-xl flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <Wifi className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Active Online</div>
            <div className="text-xl font-black text-emerald-300 font-mono mt-0.5">{onlineCount}</div>
          </div>
        </div>

        {/* Card 3: Offline Terminals */}
        <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-xl flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 flex items-center justify-center shrink-0">
            <WifiOff className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Offline Terminals</div>
            <div className="text-xl font-black text-slate-300 font-mono mt-0.5">{offlineCount}</div>
          </div>
        </div>

        {/* Card 4: Locked Terminals */}
        <div className="bg-slate-900 border border-rose-900/40 p-4 rounded-xl flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-rose-400 uppercase tracking-wider">Remote Locked</div>
            <div className="text-xl font-black text-rose-300 font-mono mt-0.5">{lockedCount}</div>
          </div>
        </div>

        {/* Card 5: Outbox Backlog */}
        <div className="bg-slate-900 border border-amber-900/40 p-4 rounded-xl flex items-center space-x-3 col-span-2 md:col-span-1">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">Queued Outbox</div>
            <div className="text-xl font-black text-amber-300 font-mono mt-0.5">{totalPendingOutbox}</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search terminal ID, name, or IP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center space-x-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {(['ALL', 'ONLINE', 'OFFLINE', 'LOCKED'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setStatusFilter(mode)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                statusFilter === mode
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal Fleet Cards / Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTerminals.map((term) => {
          const isThisDevice = term.id === currentTerminalId;
          const isBusy = activeActionId === term.id;

          return (
            <div
              key={term.id}
              className={`bg-slate-900 border rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 relative overflow-hidden ${
                term.is_locked
                  ? 'border-rose-800/80 shadow-lg shadow-rose-950/30'
                  : term.is_online
                  ? 'border-slate-800 hover:border-blue-500/40 shadow-md'
                  : 'border-slate-800/80 opacity-90'
              }`}
            >
              {/* Header: Terminal ID & Device status */}
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-sm truncate">{term.name || term.id}</span>
                      {isThisDevice && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[9px] font-black uppercase font-mono tracking-tight shrink-0">
                          THIS DEVICE
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{term.id}</p>
                  </div>

                  {/* Online/Offline Status Badge */}
                  <div className="shrink-0 flex items-center space-x-1">
                    {term.is_online ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Online</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                        <span>Offline</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Telemetry Details */}
                <div className="mt-4 space-y-2 border-t border-slate-800/80 pt-3 text-xs">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-500 flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span>Last Heartbeat:</span>
                    </span>
                    <span className="font-mono font-bold text-slate-200">
                      {formatLastSeen(term.last_heartbeat)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-500">IP Address:</span>
                    <span className="font-mono text-slate-300">{term.ip_address || '127.0.0.1'}</span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-500">App Version:</span>
                    <span className="font-mono text-slate-300">v{term.app_version || '2.4.0'}</span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-500 flex items-center space-x-1">
                      <Database className="w-3.5 h-3.5 text-slate-500" />
                      <span>Queued Outbox:</span>
                    </span>
                    {term.pending_outbox_count > 0 ? (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold font-mono text-[11px]">
                        {term.pending_outbox_count} pending
                      </span>
                    ) : (
                      <span className="text-emerald-400 font-bold font-mono text-[11px] flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Synced</span>
                      </span>
                    )}
                  </div>

                  {/* Security Lock Notice */}
                  {term.is_locked && (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-[11px] flex items-start space-x-2">
                      <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-rose-200">Terminal Remotely Locked</div>
                        <div className="text-[10px] text-rose-400/90 mt-0.5">
                          Reason: "{term.lock_reason || 'Store management security hold'}"
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Controls */}
              <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center space-x-1 text-[11px] text-slate-500">
                  <Shield className="w-3.5 h-3.5" />
                  <span>{term.is_locked ? 'Lock Active' : 'Authorized'}</span>
                </div>

                {isAuthorizedManager && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleToggleLock(term)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 ${
                      term.is_locked
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20'
                        : 'bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30'
                    }`}
                  >
                    {isBusy ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : term.is_locked ? (
                      <>
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Unlock Terminal</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>Remote Lock</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredTerminals.length === 0 && !isLoading && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
          <Monitor className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white">No POS Terminals Found</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {searchQuery || statusFilter !== 'ALL'
              ? 'No terminals match the selected filter or search query.'
              : 'Terminals automatically register telemetry heartbeats when cashiers open the POS register.'}
          </p>
        </div>
      )}

      {/* Lock Reason Prompt Modal */}
      {selectedTerminalForLock && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-scaleUp">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-2 text-rose-400">
                <ShieldAlert className="w-5 h-5" />
                <h3 className="font-black text-white text-base">Remote Terminal Lockdown</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTerminalForLock(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="my-4 space-y-3">
              <p className="text-xs text-slate-300">
                Are you sure you want to remotely lock terminal{' '}
                <strong className="text-white font-mono">{selectedTerminalForLock.name || selectedTerminalForLock.id}</strong>?
                The counter interface will be immediately locked and checkout mutations blocked.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">
                  Lock Reason / Message for Cashier:
                </label>
                <input
                  type="text"
                  value={lockReason}
                  onChange={(e) => setLockReason(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                  placeholder="e.g. End of shift / Discrepancy investigation"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedTerminalForLock(null)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLock}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 flex items-center space-x-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Confirm Lockdown</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
