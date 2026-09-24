export interface CheckResult {
  ok: boolean;
  reason?: string;
  // Set when the check failed only because there isn't enough history
  // yet, so a UI can say "warming up" instead of implying bad data.
  warmingUp?: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

// Rejects a price that's non-positive or that deviates too far from
// recent history — added after a corrupted liquidity value produced an
// absurd price in reference DeFi bot implementations (PRD section 5a).
// Fails closed without enough history: a price can't be judged against
// a median that doesn't exist yet.
export function priceSanityCheck(
  price: number,
  recentTicks: number[],
  maxDeviationPct = 0.05,
  minReadings = 1
): CheckResult {
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: `non-positive or non-finite price: ${price}` };
  }
  if (recentTicks.length < Math.max(1, minReadings)) {
    return {
      ok: false,
      warmingUp: true,
      reason: `warming up: ${recentTicks.length} of ${Math.max(1, minReadings)} price readings`,
    };
  }
  const recentMedian = median(recentTicks);
  const deviation = Math.abs(price - recentMedian) / recentMedian;
  if (deviation > maxDeviationPct) {
    return {
      ok: false,
      reason: `price ${price} deviates ${(deviation * 100).toFixed(2)}% from recent median ${recentMedian}, exceeds ${(maxDeviationPct * 100).toFixed(2)}% bound`,
    };
  }
  return { ok: true };
}

// Rejects sizing a trade against thin liquidity.
export function liquidityDepthCheck(depth: number, minDepth: number): CheckResult {
  if (!Number.isFinite(depth) || depth < minDepth) {
    return { ok: false, reason: `liquidity depth ${depth} below minimum ${minDepth}` };
  }
  return { ok: true };
}
