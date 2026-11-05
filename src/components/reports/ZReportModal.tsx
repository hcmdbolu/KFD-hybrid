import React, { useState, useMemo } from 'react';
import {
  FileText,
  Printer,
  Share2,
  Copy,
  CheckCircle2,
  X,
  Calendar,
  TrendingUp,
  Banknote,
  CreditCard,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { usePos } from '../../context/PosContext';

interface ZReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ZReportModal: React.FC<ZReportModalProps> = ({ isOpen, onClose }) => {
  const {
    sales,
    refunds,
    employees,
    receiptSettings,
    activeStaff,
    currentStoreId,
    currentBranchId,
    lowStockCount,
    expiringSoonCount,
  } = usePos();

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [branchScope, setBranchScope] = useState<'ALL' | 'CURRENT'>('ALL');
  const [copiedNotice, setCopiedNotice] = useState<boolean>(false);

  const report = useMemo(() => {
    const daySales = sales.filter(s => {
      if (s.is_historical_import) return false;
      const d = (s.date_time || '').slice(0, 10);
      if (d !== selectedDate) return false;
      if (branchScope === 'CURRENT' && s.branch_id && s.branch_id !== currentBranchId) {
        return false;
      }
      return true;
    });

    const dayRefunds = refunds.filter(r => {
      const d = (r.date_time || '').slice(0, 10);
      return d === selectedDate;
    });

    let grossSubtotal = 0;
    let totalDiscounts = 0;
    let netSales = 0;
    let totalCogs = 0;
    let cashTotal = 0;
    let posTotal = 0;
    let transferTotal = 0;
    let creditTotal = 0;

    const cashierMap = new Map<string, { name: string; count: number; total: number }>();

    for (const s of daySales) {
      grossSubtotal += Number(s.total_amount) || 0;
      totalDiscounts += Number(s.discount_applied) || 0;
      netSales += Number(s.final_amount) || 0;

      for (const item of s.items || []) {
        const unitCost = Number(item.cost_price) || 0;
        totalCogs += unitCost * (Number(item.quantity_sold) || 0);
      }

      if (s.payment_method === 'Split Payment' && Array.isArray(s.payment_splits)) {
        for (const sp of s.payment_splits) {
          if (sp.method === 'Cash') cashTotal += Number(sp.amount) || 0;
          else if (sp.method === 'POS') posTotal += Number(sp.amount) || 0;
          else if (sp.method === 'Bank Transfer') transferTotal += Number(sp.amount) || 0;
        }
      } else if (s.payment_method === 'Cash') {
        cashTotal += Number(s.final_amount) || 0;
      } else if (s.payment_method === 'POS') {
        posTotal += Number(s.final_amount) || 0;
      } else if (s.payment_method === 'Bank Transfer') {
        transferTotal += Number(s.final_amount) || 0;
      } else if (s.payment_method === 'Credit / Pay Later') {
        const dep = Number(s.deposit_amount) || 0;
        const bal = Number(s.balance_due) || Math.max(0, (Number(s.final_amount) || 0) - dep);
        creditTotal += bal;
        if (dep > 0) {
          if (s.deposit_payment_method === 'POS') posTotal += dep;
          else if (s.deposit_payment_method === 'Bank Transfer') transferTotal += dep;
          else cashTotal += dep;
        }
      }

      const cKey = s.staff_id || 'UNKNOWN';
      const emp = employees.find(e => e.staff_id === cKey);
      const existing = cashierMap.get(cKey) || { name: emp?.staff_name || cKey, count: 0, total: 0 };
      existing.count += 1;
      existing.total += Number(s.final_amount) || 0;
      cashierMap.set(cKey, existing);
    }

    const totalRefunds = dayRefunds.reduce((sum, r) => sum + (Number(r.refund_amount) || 0), 0);
    const netRevenueAfterRefunds = Math.max(0, netSales - totalRefunds);
    const grossProfit = netRevenueAfterRefunds - totalCogs;
    const marginPercent = netRevenueAfterRefunds > 0
      ? Math.round((grossProfit / netRevenueAfterRefunds) * 1000) / 10
      : 0;

    return {
      transactionCount: daySales.length,
      refundCount: dayRefunds.length,
      grossSubtotal,
      totalDiscounts,
      netSales,
      totalRefunds,
      netRevenueAfterRefunds,
      totalCogs,
      grossProfit,
      marginPercent,
      cashTotal,
      posTotal,
      transferTotal,
      creditTotal,
      cashiers: Array.from(cashierMap.values()),
    };
  }, [sales, refunds, employees, selectedDate, branchScope, currentBranchId]);

  if (!isOpen) return null;

  const storeTitle = receiptSettings?.business_name || 'SMARTSALES RETAIL LTD';

  const buildDigestText = () => {
    const lines = [
      `📊 *${storeTitle} — END-OF-DAY Z-REPORT*`,
      `📅 Date: ${selectedDate}`,
      `🏪 Store: ${currentStoreId} (${branchScope === 'CURRENT' ? currentBranchId : 'All Branches'})`,
      `----------------------------------------`,
      `🧾 Transactions: ${report.transactionCount} sales (${report.refundCount} refunds)`,
      `💰 Gross Sales: ₦${report.grossSubtotal.toLocaleString()}`,
      `🏷️ Discounts: -₦${report.totalDiscounts.toLocaleString()}`,
      `↩️ Refunds: -₦${report.totalRefunds.toLocaleString()}`,
      `✅ *Net Revenue: ₦${report.netRevenueAfterRefunds.toLocaleString()}*`,
      `📈 *Gross Profit: ₦${report.grossProfit.toLocaleString()} (${report.marginPercent}%)*`,
      `----------------------------------------`,
      `💳 *TENDER BREAKDOWN:*`,
      `• Cash in Till: ₦${report.cashTotal.toLocaleString()}`,
      `• POS Terminals: ₦${report.posTotal.toLocaleString()}`,
      `• Bank Transfers: ₦${report.transferTotal.toLocaleString()}`,
      `• Customer Credit: ₦${report.creditTotal.toLocaleString()}`,
      `----------------------------------------`,
      `⚠️ Alerts: ${lowStockCount} Low Stock | ${expiringSoonCount} Expiring Soon`,
      `👤 Generated by: ${activeStaff.staff_name} (${activeStaff.role})`,
    ];
    return lines.join('\n');
  };

  const handleCopyDigest = async () => {
    try {
      await navigator.clipboard.writeText(buildDigestText());
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 3000);
    } catch {}
  };

  const handleShareWhatsApp = () => {
    const encoded = encodeURIComponent(buildDigestText());
    window.open(`https://wa.me/?text=${encoded}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight text-white">
                End-of-Day (Z-Report) & Executive Digest
              </h2>
              <p className="text-xs text-slate-400">
                Daily shift closing reconciliation, tender breakdown & instant WhatsApp/Email summary
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span className="font-bold text-slate-700">Report Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-800"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-slate-200/80 p-1 rounded-xl font-bold">
            <button
              type="button"
              onClick={() => setBranchScope('ALL')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                branchScope === 'ALL' ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
            >
              All Store Branches
            </button>
            <button
              type="button"
              onClick={() => setBranchScope('CURRENT')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                branchScope === 'CURRENT' ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
            >
              Active Branch ({currentBranchId})
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Primary Financial Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Transactions</div>
              <div className="text-xl font-black text-slate-900 mt-1">{report.transactionCount}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{report.refundCount} refunds</div>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
              <div className="text-[11px] font-bold text-emerald-700 uppercase">Net Revenue</div>
              <div className="text-lg font-black text-emerald-900 mt-1 font-mono">
                ₦{report.netRevenueAfterRefunds.toLocaleString()}
              </div>
              <div className="text-[10px] text-emerald-700 mt-0.5">
                Discounts: ₦{report.totalDiscounts.toLocaleString()}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-cyan-50 border border-cyan-200">
              <div className="text-[11px] font-bold text-cyan-700 uppercase flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                <span>Gross Profit</span>
              </div>
              <div className="text-lg font-black text-cyan-900 mt-1 font-mono">
                ₦{report.grossProfit.toLocaleString()}
              </div>
              <div className="text-[10px] text-cyan-700 mt-0.5">Margin: {report.marginPercent}%</div>
            </div>

            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200">
              <div className="text-[11px] font-bold text-amber-800 uppercase flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                <span>Stock Alerts</span>
              </div>
              <div className="text-lg font-black text-amber-900 mt-1">
                {lowStockCount + expiringSoonCount}
              </div>
              <div className="text-[10px] text-amber-700 mt-0.5">
                {lowStockCount} low • {expiringSoonCount} expiring
              </div>
            </div>
          </div>

          {/* Payment Tender Breakdown */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
            <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Banknote className="w-4 h-4 text-emerald-600" />
              <span>Payment Channel Reconciliation</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-white p-3 rounded-xl border border-slate-200/80">
                <div className="text-slate-500 font-semibold">Cash in Drawer</div>
                <div className="text-sm font-black text-slate-900 font-mono mt-1">
                  ₦{report.cashTotal.toLocaleString()}
                </div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200/80">
                <div className="text-slate-500 font-semibold">POS Terminals</div>
                <div className="text-sm font-black text-slate-900 font-mono mt-1">
                  ₦{report.posTotal.toLocaleString()}
                </div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200/80">
                <div className="text-slate-500 font-semibold">Bank Transfers</div>
                <div className="text-sm font-black text-slate-900 font-mono mt-1">
                  ₦{report.transferTotal.toLocaleString()}
                </div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200/80">
                <div className="text-slate-500 font-semibold">Credit Issued</div>
                <div className="text-sm font-black text-rose-700 font-mono mt-1">
                  ₦{report.creditTotal.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Cashier Shift Breakdown */}
          {report.cashiers.length > 0 && (
            <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-2.5">
              <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-600" />
                <span>Operator Shift Totals</span>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {report.cashiers.map((c, idx) => (
                  <div key={idx} className="py-2 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900">{c.name}</span>
                      <span className="text-slate-500 ml-2">({c.count} sales)</span>
                    </div>
                    <span className="font-mono font-bold text-slate-900">
                      ₦{c.total.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyDigest}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {copiedNotice ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-700">Digest Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-slate-600" />
                  <span>Copy Digest</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <Share2 className="w-4 h-4" />
              <span>Share via WhatsApp</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4 text-cyan-400" />
              <span>Print Z-Report</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
