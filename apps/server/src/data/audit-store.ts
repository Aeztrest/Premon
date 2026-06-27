import type { Decision } from "../domain/decision.js";

export type AuditRecord = {
  id: string;
  timestamp: string;
  network: string;
  chainId: number;
  safe: boolean;
  confidence: "low" | "medium" | "high";
  riskCodes: string[];
  contractAddresses: string[];
  primaryAction: string;
  userWallet: string | null;
  integratorRequestId?: string;
  durationMs: number;
};

export type ContractStat = {
  address: string;
  totalSeen: number;
  blockedCount: number;
  riskCodes: Record<string, number>;
  lastSeen: string;
};

const MAX_RECORDS = 10_000;

/** In-memory audit trail. Last 10k analyses; reset on restart (no persistence). */
class AuditStore {
  private readonly records: AuditRecord[] = [];
  private readonly contracts = new Map<string, ContractStat>();
  private counter = 0;

  record(decision: Decision, ctx: { durationMs: number; userWallet: string | null }): void {
    this.counter += 1;
    const contractAddresses = decision.annotation?.summary.involvedContracts ?? [];
    const rec: AuditRecord = {
      id: `a_${this.counter}`,
      timestamp: decision.meta.simulatedAt,
      network: decision.meta.network,
      chainId: decision.meta.chainId,
      safe: decision.safe,
      confidence: decision.meta.confidence,
      riskCodes: decision.riskFindings.map((f) => f.code),
      contractAddresses,
      primaryAction: decision.annotation?.summary.primaryAction ?? "unknown",
      userWallet: ctx.userWallet,
      integratorRequestId: decision.meta.integratorRequestId,
      durationMs: ctx.durationMs,
    };
    this.records.push(rec);
    if (this.records.length > MAX_RECORDS) this.records.shift();

    for (const addr of contractAddresses) {
      const stat = this.contracts.get(addr) ?? {
        address: addr,
        totalSeen: 0,
        blockedCount: 0,
        riskCodes: {},
        lastSeen: rec.timestamp,
      };
      stat.totalSeen += 1;
      if (!decision.safe) stat.blockedCount += 1;
      for (const code of rec.riskCodes) {
        stat.riskCodes[code] = (stat.riskCodes[code] ?? 0) + 1;
      }
      stat.lastSeen = rec.timestamp;
      this.contracts.set(addr, stat);
    }
  }

  recent(limit = 200): AuditRecord[] {
    return this.records.slice(-Math.min(limit, MAX_RECORDS)).reverse();
  }

  aggregate(): {
    total: number;
    blocked: number;
    topRiskCodes: { code: string; count: number }[];
    topBlockedContracts: { address: string; blockedCount: number }[];
  } {
    const codeCounts = new Map<string, number>();
    let blocked = 0;
    for (const r of this.records) {
      if (!r.safe) blocked += 1;
      for (const c of r.riskCodes) codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1);
    }
    const topRiskCodes = [...codeCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const topBlockedContracts = [...this.contracts.values()]
      .filter((c) => c.blockedCount > 0)
      .map((c) => ({ address: c.address, blockedCount: c.blockedCount }))
      .sort((a, b) => b.blockedCount - a.blockedCount)
      .slice(0, 10);
    return { total: this.records.length, blocked, topRiskCodes, topBlockedContracts };
  }

  contract(address: string): ContractStat | null {
    return this.contracts.get(address) ?? this.contracts.get(address.toLowerCase()) ?? null;
  }
}

let singleton: AuditStore | null = null;

export function getAuditStore(): AuditStore {
  if (!singleton) singleton = new AuditStore();
  return singleton;
}

export type { AuditStore };
