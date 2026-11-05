import React, { useState } from 'react';
import { 
  Building2, 
  Store, 
  Fish, 
  ShoppingBag, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight, 
  ChevronLeft, 
  ShieldCheck, 
  X, 
  Loader2,
  Lock,
  User,
  Phone,
  MapPin,
  Coins
} from 'lucide-react';
import { usePos } from '../../context/PosContext';
import { TenantVertical, TenantConfig } from '../../types';
import { getApiUrl } from '../../utils/apiClient';

interface BusinessOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTenantCreated?: (tenant: TenantConfig) => void;
}

interface VerticalOption {
  id: TenantVertical;
  title: string;
  badge: string;
  icon: React.ReactNode;
  description: string;
  features: string[];
  gradient: string;
  borderColor: string;
}

const VERTICAL_OPTIONS: VerticalOption[] = [
  {
    id: 'COLD_ROOM',
    title: 'Fish Cold Room & Frozen Foods',
    badge: 'Popular for Cold Rooms',
    icon: <Fish className="w-6 h-6 text-cyan-400" />,
    description: 'Specialized for wholesale & retail frozen fish, poultry, seafood, and meat cold rooms.',
    features: [
      'Dual Units: Kilograms (KG) & Cartons (CTN)',
      'Wholesale 50kg+ bulk price discount tiers',
      'Thaw weight loss & cold storage shrinkage audits',
      'Electronic scale tare weight calibration'
    ],
    gradient: 'from-cyan-950/60 to-blue-950/40',
    borderColor: 'border-cyan-500/40 hover:border-cyan-400',
  },
  {
    id: 'PROVISION_STORE',
    title: 'Provision & Supermarket Store',
    badge: 'FMCG & Groceries',
    icon: <Store className="w-6 h-6 text-emerald-400" />,
    description: 'Optimized for provision retail, supermarkets, bulk drinks, and packaged consumer goods.',
    features: [
      'Unit conversions: Pieces (PCS), Packs & Cartons',
      'Automated barcode scanning ready',
      'Batch expiration tracking & expiry alerts',
      'High-speed cashier counter barcode workflow'
    ],
    gradient: 'from-emerald-950/60 to-teal-950/40',
    borderColor: 'border-emerald-500/40 hover:border-emerald-400',
  },
  {
    id: 'BOUTIQUE',
    title: 'Fashion Boutique & Apparel',
    badge: 'Style & Clothing',
    icon: <ShoppingBag className="w-6 h-6 text-pink-400" />,
    description: 'Designed for fashion houses, apparel boutiques, footwear, and luxury accessory stores.',
    features: [
      'Variant mapping: Sizes, colors & styles',
      'VIP customer tiered discount rates',
      'Tag scanning & gift voucher credits',
      'Returns & store credit voucher system'
    ],
    gradient: 'from-pink-950/60 to-purple-950/40',
    borderColor: 'border-pink-500/40 hover:border-pink-400',
  },
  {
    id: 'GENERAL_RETAIL',
    title: 'General Retail & Wholesale',
    badge: 'Multi-Purpose',
    icon: <Building2 className="w-6 h-6 text-amber-400" />,
    description: 'Flexible general trading layout suitable for hardware, electronics, cosmetics, or pharmacy.',
    features: [
      'Multi-unit retail & master cartons',
      'Customer debt credit ledger & pay later',
      'Multi-drawer split payment cash/transfer/POS',
      'Manager override discount protection shield'
    ],
    gradient: 'from-amber-950/60 to-orange-950/40',
    borderColor: 'border-amber-500/40 hover:border-amber-400',
  },
];

export const BusinessOnboardingModal: React.FC<BusinessOnboardingModalProps> = ({
  isOpen,
  onClose,
  onTenantCreated,
}) => {
  const { setCurrentStoreId, setCurrentBranchId, activeStaff, isAuthenticated, triggerOutboxFlush, forceSync } = usePos();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State
  const [businessName, setBusinessName] = useState('');
  const [vertical, setVertical] = useState<TenantVertical>('COLD_ROOM');
  const [currency, setCurrency] = useState('NGN');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [canCreateBranches, setCanCreateBranches] = useState(false);

  // Admin Account State
  const [adminName, setAdminName] = useState('Store Administrator');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPin, setAdminPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  // Result state
  const [registeredTenant, setRegisteredTenant] = useState<TenantConfig | null>(null);

  if (!isOpen) return null;

  const handleNextStep1 = () => {
    setErrorMessage(null);
    if (!businessName.trim() || businessName.trim().length < 2) {
      setErrorMessage('Please enter a valid business name (minimum 2 characters).');
      return;
    }
    setStep(2);
  };

  const handleNextStep2 = () => {
    setErrorMessage(null);
    setStep(3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!adminUsername.trim()) {
      setErrorMessage('Admin username is required.');
      return;
    }

    if (!/^\d{4}$/.test(adminPin.trim())) {
      setErrorMessage('Admin security PIN must be exactly 4 numeric digits.');
      return;
    }

    if (adminPin !== confirmPin) {
      setErrorMessage('PIN confirmation does not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(getApiUrl('/api/v1/tenants/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: businessName.trim(),
          vertical,
          currency: currency.trim() || 'NGN',
          phone: phone.trim(),
          address: address.trim(),
          admin_name: adminName.trim(),
          admin_username: adminUsername.trim(),
          admin_pin: adminPin.trim(),
          can_create_branches: canCreateBranches,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to register business tenant.');
      }

      const createdTenant: TenantConfig = data.tenant;
      setRegisteredTenant(createdTenant);

      // Instantly switch context to the new tenant store and its main branch
      setCurrentStoreId(createdTenant.store_id);
      if (createdTenant.branches?.[0]?.branch_id) {
        setCurrentBranchId(createdTenant.branches[0].branch_id);
      }
      await triggerOutboxFlush();
      await forceSync();

      if (onTenantCreated) {
        onTenantCreated(createdTenant);
      }

      setStep(4);
    } catch (err: any) {
      console.error('Tenant onboarding error:', err);
      setErrorMessage(err.message || 'Error creating business store.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetFormAndClose = () => {
    setStep(1);
    setBusinessName('');
    setVertical('COLD_ROOM');
    setCurrency('NGN');
    setPhone('');
    setAddress('');
    setAdminPin('');
    setConfirmPin('');
    setErrorMessage(null);
    setRegisteredTenant(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 shadow-lg shadow-cyan-500/20 text-white">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">
                New Business Setup Wizard
              </h2>
              <p className="text-xs text-slate-400">
                Multi-Tenant Cloud Registration & Vertical Seed Engine
              </p>
            </div>
          </div>
          {step !== 4 && (
            <button
              onClick={resetFormAndClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Wizard Step Progress Bar */}
        {step !== 4 && (
          <div className="px-6 py-3 bg-slate-900/80 border-b border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold transition-all ${
                step === 1 ? 'bg-cyan-500 text-slate-950 ring-2 ring-cyan-400/40' : 'bg-slate-800 text-slate-400'
              }`}>
                1
              </span>
              <span className={step === 1 ? 'text-cyan-400 font-semibold' : 'text-slate-400'}>
                Store Profile
              </span>
            </div>
            <div className="w-8 h-px bg-slate-800" />
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold transition-all ${
                step === 2 ? 'bg-cyan-500 text-slate-950 ring-2 ring-cyan-400/40' : 'bg-slate-800 text-slate-400'
              }`}>
                2
              </span>
              <span className={step === 2 ? 'text-cyan-400 font-semibold' : 'text-slate-400'}>
                Industry Vertical
              </span>
            </div>
            <div className="w-8 h-px bg-slate-800" />
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold transition-all ${
                step === 3 ? 'bg-cyan-500 text-slate-950 ring-2 ring-cyan-400/40' : 'bg-slate-800 text-slate-400'
              }`}>
                3
              </span>
              <span className={step === 3 ? 'text-cyan-400 font-semibold' : 'text-slate-400'}>
                Admin Account
              </span>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* STEP 1: Store Profile */}
          {step === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Business / Store Name *
                </label>
                <div className="relative">
                  <Store className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={businessName}
                    onChange={e => setBusinessName(e.target.value)}
                    placeholder="e.g. SmartSales Seafood & Cold Room"
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                    autoFocus
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  This name prints on thermal receipts and isolates your terminal database.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Currency Symbol / Code
                  </label>
                  <div className="relative">
                    <Coins className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      value={currency}
                      onChange={e => setCurrency(e.target.value)}
                      placeholder="NGN (₦)"
                      className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Phone Contact
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+234 803 000 0000"
                      className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Physical Store Address
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="e.g. Shop 12, Terminal Plaza, Marina, Lagos"
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                </div>
              </div>

              {isAuthenticated && activeStaff?.role === 'Super Admin' && (
                <label className="flex items-center justify-between p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/40 cursor-pointer">
                  <div>
                    <div className="text-xs font-bold text-indigo-200">
                      Grant Multi-Branch Creation Permission
                    </div>
                    <div className="text-[11px] text-indigo-300/80">
                      Allow this store's administrator to create additional branches (`can_create_branches`)
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={canCreateBranches}
                    onChange={e => setCanCreateBranches(e.target.checked)}
                    className="w-4 h-4 rounded border-indigo-500 bg-slate-900 text-indigo-500"
                  />
                </label>
              )}
            </div>
          )}

          {/* STEP 2: Industry Vertical Selector */}
          {step === 2 && (
            <div className="space-y-3.5 animate-fadeIn">
              <div className="text-xs text-slate-400">
                Choose your industry specialty. The engine will automatically seed custom measurement units, categories, receipt templates, and wholesale rules.
              </div>

              <div className="grid grid-cols-1 gap-3">
                {VERTICAL_OPTIONS.map(opt => {
                  const isSelected = vertical === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => setVertical(opt.id)}
                      className={`cursor-pointer p-4 rounded-xl border transition-all relative overflow-hidden bg-gradient-to-r ${opt.gradient} ${
                        isSelected 
                          ? 'border-cyan-400 ring-2 ring-cyan-500/30 shadow-lg shadow-cyan-950/50' 
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-700/60">
                            {opt.icon}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-white">{opt.title}</h3>
                              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                                {opt.badge}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">{opt.description}</p>
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                          isSelected ? 'bg-cyan-500 border-cyan-400 text-slate-950' : 'border-slate-700'
                        }`}>
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-300">
                        {opt.features.map((feat, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                            <span>{feat}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: Admin Account */}
          {step === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-300 flex items-center gap-3">
                <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>
                  Configure the primary Owner / Administrator account for <strong>{businessName}</strong>. This account will have full access to management reports, inventory, and refunds.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Admin Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={adminName}
                    onChange={e => setAdminName(e.target.value)}
                    placeholder="Store Administrator"
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Login Username *
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={adminUsername}
                    onChange={e => setAdminUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    4-Digit Security PIN *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="password"
                      maxLength={4}
                      value={adminPin}
                      onChange={e => setAdminPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••"
                      className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white text-center tracking-[0.3em] font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Confirm PIN *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="password"
                      maxLength={4}
                      value={confirmPin}
                      onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••"
                      className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white text-center tracking-[0.3em] font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Success Screen */}
          {step === 4 && registeredTenant && (
            <div className="text-center py-6 space-y-4 animate-fadeIn">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 text-emerald-400 flex items-center justify-center mx-auto shadow-xl shadow-emerald-950/40">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-white">
                  Store Successfully Provisioned!
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Tenant partition and local SQLite WAL outbox are active.
                </p>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 max-w-md mx-auto text-left space-y-2 text-xs">
                <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                  <span className="text-slate-400">Store Name:</span>
                  <span className="font-semibold text-white">{registeredTenant.business_name}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                  <span className="text-slate-400">Store Identifier:</span>
                  <span className="font-mono font-semibold text-cyan-400">{registeredTenant.store_id}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                  <span className="text-slate-400">Industry Vertical:</span>
                  <span className="font-semibold text-emerald-400">{registeredTenant.vertical}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Admin Username:</span>
                  <span className="font-semibold text-white">{adminUsername}</span>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Your terminal has automatically switched to this store. You may now start recording transactions offline or online.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={resetFormAndClose}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNextStep1}
                className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-cyan-900/40 flex items-center gap-2 transition-all"
              >
                Continue to Vertical Selection
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="button"
                onClick={handleNextStep2}
                className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-cyan-900/40 flex items-center gap-2 transition-all"
              >
                Configure Admin Credentials
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-900/40 flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Registering Store & Initializing Seed...
                  </>
                ) : (
                  <>
                    Complete Registration & Launch
                    <CheckCircle2 className="w-4 h-4" />
                  </>
                )}
              </button>
            </>
          )}

          {step === 4 && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={resetFormAndClose}
                className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-cyan-900/40 transition-all"
              >
                Open POS Register & Start Selling
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
