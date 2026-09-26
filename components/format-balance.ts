// Wallet balances for the header chip. /api/status returns every on-chain
// decimal ("4.975031264553765393"); the chip shows a readable figure,
// rounded to `decimals` places without trailing zeros. A non-zero balance
// too small to show reads "<0.0001" rather than a misleading "0".

export function formatBalance(raw: string, decimals: number): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  if (value === 0) return "0";
  const smallest = 10 ** -decimals;
  if (Math.abs(value) < smallest / 2) return `<${smallest.toFixed(decimals)}`;
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

export function walletChipLabel(b: { bnb: string; usdt: string; msftb: string }): string {
  return `Wallet · ${formatBalance(b.bnb, 4)} BNB · ${formatBalance(b.usdt, 3)} USDT · ${formatBalance(b.msftb, 6)} MSFTB`;
}
