import React, { useState } from 'react';
import { X, Lock, Check, Loader2 } from 'lucide-react';

function findPackage(offerings, type) {
  if (!offerings || !offerings.availablePackages) return null;
  return offerings.availablePackages.find((p) => p.packageType === type) || null;
}

function PriceCard({ badge, title, price, priceSub, note, onSelect, busy, disabled, highlighted }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || busy}
      className={`w-full text-left rounded-sm border px-4 py-4 transition-colors ${
        highlighted
          ? 'border-amber-500 bg-amber-950/20'
          : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
      } disabled:opacity-50`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {badge && (
            <span className="inline-block text-[10px] font-mono tracking-wide text-amber-500 border border-amber-700/70 rounded-sm px-1.5 py-0.5 mb-1.5">
              {badge}
            </span>
          )}
          <div className="font-serif text-lg text-slate-100">{title}</div>
          {note && <div className="text-xs text-slate-400 mt-0.5">{note}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-xl font-bold text-amber-400">{price}</div>
          {priceSub && <div className="text-xs text-slate-400">{priceSub}</div>}
        </div>
      </div>
      {busy && (
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-2">
          <Loader2 size={12} className="animate-spin" /> Processing…
        </div>
      )}
    </button>
  );
}

export default function Paywall({ onClose, purchasePackage, restorePurchases, offerings, loading, error, isNative }) {
  const [busyKey, setBusyKey] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [localError, setLocalError] = useState('');

  const monthly = findPackage(offerings, 'MONTHLY');
  const annual = findPackage(offerings, 'ANNUAL');
  const lifetime = findPackage(offerings, 'LIFETIME');

  async function handleBuy(pkg, key) {
    if (!pkg) return;
    setLocalError('');
    setBusyKey(key);
    const result = await purchasePackage(pkg);
    setBusyKey(null);
    if (result.success) onClose();
  }

  async function handleRestore() {
    setLocalError('');
    setRestoring(true);
    const result = await restorePurchases();
    setRestoring(false);
    if (result.success) onClose();
    else if (!result.success) setLocalError('No previous purchase found for this Apple ID.');
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-slate-950 border border-amber-700/40 rounded-t-lg sm:rounded-sm max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-slate-950 border-b border-slate-800 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-amber-500" />
            <span className="font-serif text-lg text-slate-100">Unlock Full Access</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-5">
          <p className="text-sm text-slate-400 leading-relaxed mb-5">
            The core Tier 2 and Tier 3 pension calculators are always free. Unlocking adds the Final Withdrawal
            planner (including the reverse target-pension solver), Deferred Compensation modeling, and the
            Accuracy Check statement scanner.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading options…
            </div>
          ) : !isNative ? (
            <p className="text-sm text-amber-400 bg-amber-950/30 border border-amber-800/50 rounded-sm px-4 py-3">
              Purchases only work in the installed app on your phone, not in this browser preview.
            </p>
          ) : (
            <div className="space-y-3">
              <PriceCard
                title="Lifetime"
                badge="BEST VALUE"
                price={lifetime ? lifetime.product.priceString : '—'}
                priceSub="once"
                note="Pay once, own it forever"
                highlighted
                busy={busyKey === 'lifetime'}
                disabled={!lifetime || busyKey !== null}
                onSelect={() => handleBuy(lifetime, 'lifetime')}
              />
              <PriceCard
                title="Annual"
                badge="MOST POPULAR"
                price={annual ? annual.product.priceString : '—'}
                priceSub="/yr"
                note="Renews automatically each year"
                busy={busyKey === 'annual'}
                disabled={!annual || busyKey !== null}
                onSelect={() => handleBuy(annual, 'annual')}
              />
              <PriceCard
                title="Monthly"
                price={monthly ? monthly.product.priceString : '—'}
                priceSub="/mo"
                note="Renews automatically each month — cancel anytime"
                busy={busyKey === 'monthly'}
                disabled={!monthly || busyKey !== null}
                onSelect={() => handleBuy(monthly, 'monthly')}
              />
            </div>
          )}

          {(error || localError) && (
            <p className="text-xs text-red-400 mt-4 leading-relaxed">{error || localError}</p>
          )}

          <p className="text-[11px] text-slate-400 leading-relaxed mt-4 text-center">
            This unlocks calculator features only. It's a planning estimate, not financial or legal advice, and
            purchasing doesn't create any advisory relationship.
          </p>

          <button
            type="button"
            onClick={handleRestore}
            disabled={restoring || !isNative}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-200 mt-5 py-2 disabled:opacity-50"
          >
            {restoring ? 'Restoring…' : 'Restore Purchases'}
          </button>

          <p className="text-[11px] text-slate-400 leading-relaxed mt-3 text-center">
            Payment charged to your Apple ID. Subscriptions auto-renew unless cancelled at least 24 hours before
            the end of the current period, in Settings → your name → Subscriptions on your iPhone.{' '}
            <a href="https://example.com/terms" className="underline">Terms</a> ·{' '}
            <a href="https://example.com/privacy" className="underline">Privacy</a>
          </p>
        </div>
      </div>
    </div>
  );
}
