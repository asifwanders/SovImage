"use client";

import { Ban, Paperclip, SendHorizonal, X } from "lucide-react";
import { useRef, useState } from "react";
import { useChats } from "@/lib/stores/chats";
import { useAttachment } from "@/lib/stores/attachment";
import { useSetup } from "@/lib/stores/setup";
import { persistAttachment } from "@/lib/attachments";
import { cn } from "@/lib/utils";

export function Composer({ chatId }: { chatId: string }) {
  // Avoid subscribing to the entire chats store — typing in the textarea
  // would re-render Composer on every animation frame coming from
  // in-flight generation events.
  const appendUserMessage = useChats((s) => s.appendUserMessage);
  const generate = useChats((s) => s.generate);
  // Negative prompt is meaningful only at tier 3 (Flux-dev w/ cfg 3.5);
  // tiers 1+2 use schnell at cfg 1.0 and ignore negative guidance.
  const tier = useSetup((s) => s.tier);
  const showNegative = tier === 3;

  // Pending attachment lives in a tiny standalone store so DropOverlay can
  // populate it from a top-level drop without prop drilling.
  const pendingPath = useAttachment((s) => s.pendingPath);
  const pendingName = useAttachment((s) => s.pendingName);
  const setAttachment = useAttachment((s) => s.set);

  const [value, setValue] = useState("");
  const [negative, setNegative] = useState("");
  const [showNegInput, setShowNegInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const negTa = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  const send = async () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await appendUserMessage(chatId, trimmed);
      setValue("");
      const init = pendingPath;
      const neg = showNegative ? negative.trim() || null : null;
      setAttachment(null, null);
      if (ta.current) ta.current.style.height = "auto";
      await generate(chatId, trimmed, init, neg);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="px-6 pb-4 pt-2 shrink-0">
      <div className="glass-panel rounded-2xl px-3 py-2 flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const r = await persistAttachment(f);
              if (r) setAttachment(r.path, r.name);
            } catch {
              /* ignore */
            }
          }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          className="p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-muted-text hover:text-accent transition-colors shrink-0"
          aria-label="Attach image"
          title="Attach image"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        {showNegative && (
          <button
            onClick={() => {
              setShowNegInput((v) => !v);
              setTimeout(() => negTa.current?.focus(), 0);
            }}
            className={cn(
              "p-2 rounded-lg transition-colors shrink-0",
              showNegInput
                ? "bg-danger/10 text-danger"
                : "hover:bg-black/10 dark:hover:bg-white/10 text-muted-text hover:text-danger",
            )}
            aria-label="Toggle negative prompt"
            title={showNegInput ? "Hide negative prompt" : "Add negative prompt"}
          >
            <Ban className="w-4 h-4" />
          </button>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          {pendingPath && (
            <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-text">
              <span className="truncate max-w-[200px]">{pendingName ?? "image"}</span>
              <button
                onClick={() => setAttachment(null, null)}
                className="hover:text-danger"
                aria-label="Remove attachment"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <textarea
            ref={ta}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              grow();
            }}
            onKeyDown={onKey}
            rows={1}
            placeholder="Describe an image, or drop one to edit…"
            aria-label="Prompt input"
            className="resize-none bg-transparent outline-none text-sm placeholder:text-muted-text max-h-[200px] leading-relaxed py-1.5"
          />
          {showNegative && showNegInput && (
            <textarea
              ref={negTa}
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              rows={1}
              placeholder="Negative prompt (avoid…)"
              aria-label="Negative prompt"
              className="resize-none bg-transparent outline-none text-xs text-danger placeholder:text-danger/40 max-h-[120px] leading-relaxed py-1 mt-1 border-t border-panel-border"
            />
          )}
        </div>

        <button
          onClick={send}
          disabled={!value.trim() || busy}
          aria-busy={busy}
          aria-label="Send"
          title="Send"
          className={cn(
            "rounded-lg p-2 transition-colors shrink-0",
            value.trim() && !busy
              ? "bg-accent text-accent-foreground hover:opacity-90"
              : "bg-panel-border text-muted-text cursor-not-allowed",
          )}
        >
          <SendHorizonal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
