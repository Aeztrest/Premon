/**
 * Token detail overlay — shows a token's balance, its CONTRACT ADDRESS
 * (copyable + QR), and an explorer link. Lets the user copy/import the token
 * address into other wallets, the way MetaMask & co. expose token info.
 *
 * Opened from the balance rows on Home.tsx.
 */

import { useEffect, useState } from "react";
import { X, Copy, Check, ExternalLink } from "lucide-react";
import QRCode from "qrcode";
import type { MonadNetwork } from "@premon/ext-protocol";
import { chainFor } from "../shared/chain";

interface Props {
  symbol: string;
  /** Token contract address (0x). */
  tokenAddress: string;
  balance: string;
  network: string;
  onClose: () => void;
}

export function TokenDetail({ symbol, tokenAddress, balance, network, onClose }: Props) {
  const chain = chainFor(network as MonadNetwork);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(tokenAddress, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 224,
      color: { dark: "#141414", light: "#00000000" },
    })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { /* address still copyable */ });
    return () => { cancelled = true; };
  }, [tokenAddress]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(tokenAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ background: "var(--bg)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line)" }}>
        <p className="font-semibold text-sm">{symbol}</p>
        <button onClick={onClose} className="p-1.5 rounded-input hover:bg-black/5">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 px-5 py-6 flex flex-col items-center gap-5 overflow-y-auto">
        <div className="text-center">
          <p className="text-3xl font-extrabold font-mono tracking-tight">{balance}</p>
          <p className="text-text-faint text-[11px] mt-1">{symbol} balance on {network}</p>
        </div>

        <div
          className="rounded-card p-4 flex items-center justify-center"
          style={{ background: "rgba(20,20,20,0.045)", border: "1px solid var(--line)" }}
        >
          {qr
            ? <img src={qr} alt={`${symbol} contract QR`} className="w-48 h-48" />
            : <div className="w-48 h-48 flex items-center justify-center text-text-faint text-xs">generating…</div>}
        </div>

        <div className="w-full">
          <p className="label">Token contract address</p>
          <button
            onClick={onCopy}
            className="w-full text-left p-3 rounded-input font-mono text-[11px] break-all flex items-start gap-2 group"
            style={{ background: "rgba(20,20,20,0.045)", border: "1px solid var(--line)" }}
          >
            <span className="flex-1 text-text-muted group-hover:text-text">{tokenAddress}</span>
            {copied
              ? <Check size={14} className="shrink-0 text-ok mt-0.5" />
              : <Copy size={14} className="shrink-0 text-text-faint group-hover:text-text mt-0.5" />}
          </button>
          {copied && <p className="text-[10px] text-ok mt-1.5">Copied to clipboard</p>}
        </div>

        <a
          href={`${chain.explorerUrl}/address/${tokenAddress}`}
          target="_blank"
          rel="noreferrer"
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-input text-sm font-semibold"
          style={{ background: "rgba(20,20,20,0.04)", border: "1px solid var(--line)" }}
        >
          <ExternalLink size={14} /> View on explorer
        </a>
        <p className="text-[10px] text-text-faint text-center max-w-[260px]">
          Copy this contract address to import {symbol} into another wallet, or
          share it so others can verify the token.
        </p>
      </div>
    </div>
  );
}
