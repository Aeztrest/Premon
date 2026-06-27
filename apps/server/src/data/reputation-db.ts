import type { RiskSeverity } from "../domain/findings.js";

export type ReputationEntry = {
  label: string;
  category: "drainer" | "phishing" | "scam" | "sanctioned" | "exploit";
  source: string;
  severity: RiskSeverity;
};

/**
 * In-memory reputation DB. Address-keyed by lower-cased 0x address so lookups
 * are case-insensitive (EVM addresses are checksummed only for display). Seeded
 * with a few illustrative entries; in production this is backed by feeds like
 * Chainabuse / ScamSniffer / Forta. Same shape as the Stellar build's DB — only
 * the entries are EVM-native.
 */
class ReputationDb {
  private readonly entries = new Map<string, ReputationEntry>();

  constructor(seed: Record<string, ReputationEntry>) {
    for (const [addr, entry] of Object.entries(seed)) {
      this.entries.set(addr.toLowerCase(), entry);
    }
  }

  lookup(address: string): ReputationEntry | undefined {
    return this.entries.get(address.toLowerCase());
  }

  lookupMany(addresses: string[]): Map<string, ReputationEntry> {
    const out = new Map<string, ReputationEntry>();
    for (const a of addresses) {
      const hit = this.lookup(a);
      if (hit) out.set(a, hit);
    }
    return out;
  }

  add(address: string, entry: ReputationEntry): void {
    this.entries.set(address.toLowerCase(), entry);
  }

  get size(): number {
    return this.entries.size;
  }
}

// Illustrative seed — replace / extend with a live feed in production.
const SEED: Record<string, ReputationEntry> = {
  "0x0000000000000000000000000000000000000bad": {
    label: "Known wallet drainer (demo seed)",
    category: "drainer",
    source: "premon-seed",
    severity: "critical",
  },
  "0x00000000000000000000000000000000deadbeef": {
    label: "Phishing approval spender (demo seed)",
    category: "phishing",
    source: "premon-seed",
    severity: "high",
  },
};

let singleton: ReputationDb | null = null;

export function getReputationDb(): ReputationDb {
  if (!singleton) singleton = new ReputationDb(SEED);
  return singleton;
}

export type { ReputationDb };
