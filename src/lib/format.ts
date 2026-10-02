/** Formatting + label helpers shared across components. */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const formatINR = (amount: number): string => inr.format(amount);

/** Compact INR for tight spaces: "₹13k", "₹18.5k". */
export const formatINRCompact = (amount: number): string => {
  if (amount >= 1000) {
    const k = amount / 1000;
    return `₹${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `₹${amount}`;
};

/** "2.1 km" / "850 m" from metres. */
export const formatDistance = (meters: number): string => {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
};

export const formatDeposit = (amount: number): string => `₹${amount.toLocaleString('en-IN')}`;
