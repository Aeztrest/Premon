import { useEffect, useState } from "react";
import { Copy, Check, ExternalLink, Download, Droplet } from "lucide-react";
import QRCode from "qrcode";
import { useWallet } from "../wallet/state";
import { explorerUrl, FAUCET_URL, NATIVE_SYMBOL } from "../wallet/connection";

export function Receive() {
  const { identity } = useWallet();
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const address = identity?.address ?? "";

  useEffect(() => {
    if (address) {
      QRCode.toDataURL(address, { margin: 1, width: 220, color: { dark: "#141414", light: "#00000000" } })
        .then(setQr)
        .catch(() => {});
    }
  }, [address]);

  if (!identity) return null;

  const onCopy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-black font-display text-ink-900 tracking-tight flex items-center gap-2">
          <Download size={20} className="text-accent" /> Receive
        </h1>
        <p className="text-ink-500 text-sm mt-1">Share your address to receive {NATIVE_SYMBOL} or ERC-20 tokens on Monad testnet.</p>
      </div>

      <div className="card p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-bold text-ink-900">Your wallet</h2>
            <p className="text-xs text-ink-500 mt-0.5">Funds live here — this EOA is your wallet on Monad.</p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
            style={{ background: "rgba(255,107,0,0.12)", color: "#EA5E00" }}>Monad Testnet</span>
        </div>

        <div className="flex justify-center py-2">
          {qr
            ? <img src={qr} alt="QR" className="w-48 h-48 rounded-xl" />
            : <div className="w-48 h-48 rounded-xl bg-ink-900/[0.04] animate-pulse" />}
        </div>

        <div className="font-mono text-xs px-3 py-2.5 rounded-lg bg-ink-900/[0.03] border border-ink-900/[0.08] break-all text-ink-800">
          {address}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCopy} className="btn-ghost">
            {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <a href={explorerUrl("address", address)} target="_blank" rel="noreferrer" className="btn-ghost">
            <ExternalLink size={13} /> Explorer
          </a>
        </div>

        <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="btn-primary w-full">
          <Droplet size={13} /> Open Monad faucet
        </a>
        <p className="text-[10px] text-ink-400 text-center">
          There's no programmatic faucet — copy your address above and paste it into the faucet to receive testnet {NATIVE_SYMBOL}.
        </p>
      </div>
    </div>
  );
}
