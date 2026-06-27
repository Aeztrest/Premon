/**
 * Send overlay — recipient address + amount in MON → broadcast via the
 * `wallet.transferNative` RPC. Minimal flow: paste, type, send.
 *
 * Validates the address client-side (EVM 0x checksum) before enabling the
 * Send button. The background handler enforces balance + builds + confirms.
 */

import { useState, useMemo } from "react";
import { isAddress } from "ethers";
import { X, Loader2, ArrowRight, ExternalLink } from "lucide-react";
import { useRpc } from "../shared/state-context";
import { explorerTxUrl } from "../shared/chain";
import type { MonadNetwork } from "@premon/ext-protocol";

interface Props {
  address: string;
  network: string;
  balanceMon: number | null;
  onClose: () => void;
  onSent: () => void;
}

const FEE_BUFFER_MON = 0.0005; // gas headroom buffer.

export function SendScreen({
  address,
  network,
  balanceMon,
  onClose,
  onSent,
}: Props) {
  const rpc = useRpc();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ txHash: string } | null>(null);

  const addressValid = useMemo(() => {
    if (!to.trim()) return false;
    return isAddress(to.trim());
  }, [to]);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const overBalance =
    balanceMon !== null && amountNum + FEE_BUFFER_MON > balanceMon;
  const sameAsSelf =
    addressValid && to.trim().toLowerCase() === address.toLowerCase();
  const canSend =
    addressValid && amountValid && !overBalance && !sameAsSelf && !sending;

  const onMax = () => {
    if (balanceMon === null) return;
    const max = Math.max(0, balanceMon - FEE_BUFFER_MON);
    setAmount(max.toFixed(6));
  };

  const onSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const r = await rpc.call("wallet.transferNative", {
        to: to.trim(),
        amountEth: amount,
      });
      setSuccess({ txHash: r.txHash });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const explorer = success
    ? explorerTxUrl(network as MonadNetwork, success.txHash)
    : null;

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--line)" }}
      >
        <p className="font-semibold text-sm">Send MON</p>
        <button
          onClick={onClose}
          className="p-1.5 rounded-input hover:bg-black/5"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 px-4 py-4 flex flex-col gap-4 overflow-y-auto">
        {success ? (
          <div className="card text-center">
            <div
              className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
              style={{ background: "var(--ok-dim)", color: "var(--ok)" }}
            >
              <ArrowRight size={20} />
            </div>
            <p className="font-bold mb-1">Sent</p>
            <p className="text-text-faint text-[11px] mb-4">
              {amount} MON →{" "}
              <span className="font-mono">
                {to.slice(0, 6)}…{to.slice(-4)}
              </span>
            </p>
            <a
              href={explorer ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-accent-soft hover:text-accent"
            >
              View on Monad Explorer <ExternalLink size={10} />
            </a>
            <button onClick={onClose} className="btn-primary w-full mt-5">
              Done
            </button>
          </div>
        ) : (
          <>
            <div>
              <label className="label">Recipient address</label>
              <input
                className="input"
                placeholder="Monad address (0x…)"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              {to.trim() && !addressValid && (
                <p className="text-bad text-[10px] mt-1.5">
                  Not a valid 0x… address.
                </p>
              )}
              {sameAsSelf && (
                <p className="text-warn text-[10px] mt-1.5">
                  That's your own address.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="label !mb-0">Amount (MON)</span>
                <button
                  onClick={onMax}
                  disabled={balanceMon === null || balanceMon <= 0}
                  className="text-[10px] text-text-faint hover:text-text disabled:opacity-40 px-2 py-0.5 rounded-input"
                  style={{
                    background: "rgba(20,20,20,0.045)",
                    border: "1px solid var(--line)",
                  }}
                >
                  Max
                </button>
              </div>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-text-faint text-[10px] mt-1.5">
                Balance:{" "}
                {balanceMon === null ? "—" : `${balanceMon.toFixed(4)} MON`}
              </p>
              {amount && !amountValid && (
                <p className="text-bad text-[10px] mt-1.5">
                  Enter a positive number.
                </p>
              )}
              {overBalance && amountValid && (
                <p className="text-bad text-[10px] mt-1.5">
                  Amount + ~{FEE_BUFFER_MON} MON gas exceeds balance.
                </p>
              )}
            </div>

            {error && (
              <div
                className="p-2.5 rounded-input text-[11px]"
                style={{ background: "var(--bad-dim)", color: "var(--bad)" }}
              >
                {error}
              </div>
            )}

            <button
              onClick={onSend}
              disabled={!canSend}
              className="btn-primary mt-auto"
            >
              {sending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Confirming…
                </>
              ) : (
                <>Send {amount && amountValid ? `${amountNum} MON` : ""}</>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
