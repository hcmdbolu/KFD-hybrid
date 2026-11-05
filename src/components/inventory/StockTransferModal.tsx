import React, { useState, useEffect } from 'react';
import { usePos } from '../../context/PosContext';
import { Product, BranchConfig } from '../../types';
import { ArrowLeftRight, X, AlertCircle, CheckCircle2, GitBranch, Warehouse } from 'lucide-react';
import { getApiUrl } from '../../utils/apiClient';

interface StockTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedProduct?: Product;
}

const STORAGE_LOCATIONS = [
  'Main Warehouse Storage A',
  'Front Store Display Shelf 1',
  'Secondary Storage Room B',
  'Backroom Restock Area',
  'Warehouse Shelf C / Secure Storage',
  'Retail Prep Station',
];

export const StockTransferModal: React.FC<StockTransferModalProps> = ({
  isOpen,
  onClose,
  preselectedProduct,
}) => {
  const { products, performStockTransfer, activeStaff, currentStoreId, currentBranchId } = usePos();

  const [transferMode, setTransferMode] = useState<'INTERNAL' | 'BRANCH'>('INTERNAL');
  const [branches, setBranches] = useState<BranchConfig[]>([]);
  const [selectedSn, setSelectedSn] = useState<string>(
    preselectedProduct?.item_sn || products[0]?.item_sn || ''
  );
  const [quantity, setQuantity] = useState<number>(10);
  const [fromLocation, setFromLocation] = useState<string>(STORAGE_LOCATIONS[0]);
  const [toLocation, setToLocation] = useState<string>(STORAGE_LOCATIONS[1]);
  const [fromBranchId, setFromBranchId] = useState<string>(currentBranchId || 'branch_main');
  const [toBranchId, setToBranchId] = useState<string>('');
  const [notes, setNotes] = useState<string>('Display shelf replenishment');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch(getApiUrl(`/api/v1/tenants/${encodeURIComponent(currentStoreId)}/branches`))
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && Array.isArray(data.branches)) {
          setBranches(data.branches);
          const firstBranch = data.branches[0]?.branch_id || 'branch_main';
          const secondBranch = data.branches[1]?.branch_id || firstBranch;
          setFromBranchId(currentBranchId || firstBranch);
          setToBranchId(secondBranch);
        }
      })
      .catch(() => {});
  }, [isOpen, currentStoreId, currentBranchId]);

  if (!isOpen) return null;

  const currentProduct = products.find(p => p.item_sn === selectedSn) || products[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!currentProduct) {
      setError('Please select a product to transfer.');
      return;
    }

    if (quantity <= 0) {
      setError('Transfer quantity must be greater than zero.');
      return;
    }

    if (transferMode === 'BRANCH') {
      if (!fromBranchId || !toBranchId) {
        setError('Please select both source and destination branches.');
        return;
      }
      if (fromBranchId === toBranchId) {
        setError('Source and destination branches cannot be identical.');
        return;
      }
      const fromBr = branches.find(b => b.branch_id === fromBranchId);
      const toBr = branches.find(b => b.branch_id === toBranchId);
      const fromLabel = fromBr ? `${fromBr.name} (${fromBr.branch_id})` : fromBranchId;
      const toLabel = toBr ? `${toBr.name} (${toBr.branch_id})` : toBranchId;

      const res = performStockTransfer({
        item_sn: currentProduct.item_sn,
        quantity,
        from_location: fromLabel,
        to_location: toLabel,
        from_branch_id: fromBranchId,
        to_branch_id: toBranchId,
        notes,
      });

      if (!res.success) {
        setError(res.error || 'Failed to execute inter-branch stock transfer.');
      } else {
        setSuccess(
          `Inter-Branch Transfer ${res.record?.transfer_id} completed! Moved ${quantity} ${currentProduct.product_measure_unit} from "${fromLabel}" to "${toLabel}".`
        );
        setTimeout(() => {
          onClose();
        }, 1500);
      }
      return;
    }

    if (fromLocation === toLocation) {
      setError('Source and destination locations cannot be identical.');
      return;
    }

    const res = performStockTransfer({
      item_sn: currentProduct.item_sn,
      quantity,
      from_location: fromLocation,
      to_location: toLocation,
      notes,
    });

    if (!res.success) {
      setError(res.error || 'Failed to execute stock transfer.');
    } else {
      setSuccess(
        `Transfer ${res.record?.transfer_id} authorized! Moved ${quantity} ${currentProduct.product_measure_unit} from "${fromLocation}" to "${toLocation}".`
      );
      setTimeout(() => {
        onClose();
      }, 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-purple-500/20 text-purple-400 rounded-xl border border-purple-500/30">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Stock & Inter-Branch Transfer</h3>
              <p className="text-xs text-slate-400">
                Warehouse, Store Shelf & Multi-Branch Movement Authorization
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Transfer Mode Tabs */}
          <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setTransferMode('INTERNAL');
                setError(null);
              }}
              className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                transferMode === 'INTERNAL'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Warehouse className="w-3.5 h-3.5" />
              <span>Internal Storage / Shelf</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTransferMode('BRANCH');
                setError(null);
                setNotes('Inter-branch stock allocation');
              }}
              className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                transferMode === 'BRANCH'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Inter-Branch Transfer ({branches.length})</span>
            </button>
          </div>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-2 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center space-x-2 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{success}</span>
            </div>
          )}

          {/* Product Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Select Product
            </label>
            <select
              value={selectedSn}
              onChange={e => setSelectedSn(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
            >
              {products.map(p => (
                <option key={p.item_sn} value={p.item_sn}>
                  {p.item_sn} - {p.item_name} (Total Stock: {p.quantity} {p.product_measure_unit})
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Quantity to Transfer ({currentProduct?.product_measure_unit})
            </label>
            <input
              type="number"
              step="any"
              min="0.01"
              value={quantity}
              onChange={e => setQuantity(parseFloat(e.target.value) || 0)}
              className="w-full bg-white border border-slate-300 rounded-xl p-3 text-sm font-bold font-mono text-slate-900 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
            />
          </div>

          {/* Locations or Branches */}
          {transferMode === 'INTERNAL' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  From (Source)
                </label>
                <select
                  value={fromLocation}
                  onChange={e => setFromLocation(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                >
                  {STORAGE_LOCATIONS.map(loc => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  To (Destination)
                </label>
                <select
                  value={toLocation}
                  onChange={e => setToLocation(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                >
                  {STORAGE_LOCATIONS.map(loc => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Source Branch
                </label>
                <select
                  value={fromBranchId}
                  onChange={e => setFromBranchId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                >
                  {branches.map(b => (
                    <option key={b.branch_id} value={b.branch_id}>
                      {b.name} (
                      {currentProduct?.branch_quantities?.[b.branch_id] ??
                        (b.is_main_branch ? currentProduct?.quantity : 0)}{' '}
                      {currentProduct?.product_measure_unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Destination Branch
                </label>
                <select
                  value={toBranchId}
                  onChange={e => setToBranchId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                >
                  {branches.map(b => (
                    <option key={b.branch_id} value={b.branch_id}>
                      {b.name} (
                      {currentProduct?.branch_quantities?.[b.branch_id] ?? 0}{' '}
                      {currentProduct?.product_measure_unit})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Transfer Purpose / Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Display replenishment for weekend retail rush"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
            />
          </div>

          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
            <span>
              Authorizing Manager: <strong className="text-slate-800">{activeStaff.staff_name}</strong> ({activeStaff.role})
            </span>
            <span className="font-mono text-purple-600 font-semibold">Auto-Logged to Audit</span>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-bold text-xs shadow-md transition-colors flex items-center space-x-1.5 cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>Authorize & Execute Transfer</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
