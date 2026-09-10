import { useState, useEffect, useCallback } from 'react';

// The entitlement identifier you create in the RevenueCat dashboard.
// All three products (monthly, annual, lifetime) should unlock this same
// entitlement — the app only ever checks this one string, never the
// individual product IDs, so which product someone bought doesn't matter.
export const ENTITLEMENT_ID = 'premium';

// Replace with your RevenueCat public SDK key (Project Settings → API Keys
// in the RevenueCat dashboard — use the Apple/iOS public key, not the secret
// key, which should never ship inside an app).
const REVENUECAT_API_KEY = 'YOUR_REVENUECAT_PUBLIC_SDK_KEY';

let PurchasesModule = null;
async function getPurchasesModule() {
  if (PurchasesModule) return PurchasesModule;
  try {
    PurchasesModule = await import('@revenuecat/purchases-capacitor');
    return PurchasesModule;
  } catch (e) {
    // Package not installed yet, or running in a plain browser (npm run dev)
    // where the native plugin has nothing to bridge to.
    return null;
  }
}

export function usePurchases() {
  const [isPremium, setIsPremium] = useState(false);
  const [offerings, setOfferings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isNative, setIsNative] = useState(false);

  const refreshCustomerInfo = useCallback(async (Purchases) => {
    try {
      const { customerInfo } = await Purchases.getCustomerInfo();
      setIsPremium(Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]));
    } catch (e) {
      setError('Could not check your purchase status. Try again shortly.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const mod = await getPurchasesModule();
      if (!mod) {
        // No native plugin available — most likely running in a browser
        // during development. Premium stays locked; purchases are disabled
        // rather than silently pretending to succeed.
        if (!cancelled) {
          setIsNative(false);
          setLoading(false);
        }
        return;
      }
      const { Purchases } = mod;
      try {
        await Purchases.configure({ apiKey: REVENUECAT_API_KEY });
        if (cancelled) return;
        setIsNative(true);
        await refreshCustomerInfo(Purchases);
        const { current } = await Purchases.getOfferings();
        if (!cancelled) setOfferings(current || null);
      } catch (e) {
        if (!cancelled) setError('Could not load purchase options. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshCustomerInfo]);

  const purchasePackage = useCallback(
    async (pkg) => {
      const mod = await getPurchasesModule();
      if (!mod) {
        setError('Purchases only work in the installed app, not in a browser preview.');
        return { success: false };
      }
      const { Purchases } = mod;
      try {
        const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
        const active = Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]);
        setIsPremium(active);
        return { success: active };
      } catch (e) {
        // RevenueCat sets a userCancelled flag on the error for a plain "tapped Cancel" —
        // that's not a real error, so don't show a scary message for it.
        if (e && e.userCancelled) return { success: false, cancelled: true };
        setError('Purchase could not be completed. Please try again.');
        return { success: false };
      }
    },
    []
  );

  const restorePurchases = useCallback(async () => {
    const mod = await getPurchasesModule();
    if (!mod) {
      setError('Restoring purchases only works in the installed app, not in a browser preview.');
      return { success: false };
    }
    const { Purchases } = mod;
    try {
      const { customerInfo } = await Purchases.restorePurchases();
      const active = Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]);
      setIsPremium(active);
      return { success: active };
    } catch (e) {
      setError('Could not restore purchases. Make sure you are signed in to the same Apple ID used originally.');
      return { success: false };
    }
  }, []);

  return { isPremium, offerings, loading, error, isNative, purchasePackage, restorePurchases };
}
