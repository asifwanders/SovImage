"use client";

import { Paperclip, SendHorizonal, X } from "lucide-react";
import { useRef, useState } from "react";
import { MAX_ATTACHMENT_BYTES } from "@/lib/image-validation";
import { isTauriRuntime } from "@/lib/ipc";
import { useAttachment } from "@/lib/stores/attachment";
import { chatAcceptsAttachments, useChats } from "@/lib/stores/chats";
import { useToasts } from "@/lib/stores/toasts";
import { cn } from "@/lib/utils";

function detail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function Composer({ chatId }: { chatId: string }) {
  const appendUserMessage = useChats((state) => state.appendUserMessage);
  const generate = useChats((state) => state.generate);
  const draft = useAttachment((state) => state.drafts[chatId]);
  const selectAttachment = useAttachment((state) => state.select);
  const settleAttachment = useAttachment((state) => state.settle);
  const restoreAttachment = useAttachment((state) => state.restore);
  const commitAttachment = useAttachment((state) => state.commit);
  const discardAttachment = useAttachment((state) => state.discard);
  const takeAttachment = useAttachment((state) => state.take);
  const pushToast = useToasts((state) => state.push);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const attach = async (input: File | (() => Promise<File>)) => {
    if (!chatAcceptsAttachments(chatId)) return;
    try {
      await selectAttachment(
        chatId,
        input,
        () => chatAcceptsAttachments(chatId),
      );
    } catch (error) {
      pushToast(`Could not attach image: ${detail(error)}`, 8000);
    }
  };

  const chooseAttachment = async () => {
    if (!isTauriRuntime()) {
      fileInput.current?.click();
      return;
    }
    try {
      const [{ open }, { readFile, stat }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
      ]);
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }],
      });
      if (!picked || typeof picked !== "string") return;
      await attach(async () => {
        const fileStat = await stat(picked);
        if (fileStat.size > MAX_ATTACHMENT_BYTES) {
          throw new Error("Images must be 25 MB or smaller.");
        }
        const bytes = await readFile(picked);
        const name = picked.split(/[\\/]/).pop() ?? "image";
        return new File([bytes], name);
      });
    } catch (error) {
      pushToast(`Could not attach image: ${detail(error)}`, 8000);
    }
  };

  const send = async () => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    if (new TextEncoder().encode(prompt).byteLength > 16 * 1024) {
      pushToast("Prompts must be 16 KB or smaller.");
      return;
    }
    setBusy(true);
    let reservation: ReturnType<typeof takeAttachment> = null;
    let messagePersisted = false;
    try {
      await settleAttachment(chatId);
      reservation = takeAttachment(chatId);
      const attachment = reservation?.draft ?? null;
      const initImagePath = attachment?.path ?? null;
      await appendUserMessage(chatId, prompt, initImagePath);
      messagePersisted = true;
      if (reservation) commitAttachment(chatId, reservation);
      setValue("");
      if (textarea.current) textarea.current.style.height = "auto";
      await generate(chatId, prompt, initImagePath);
    } catch (error) {
      if (reservation && !messagePersisted) {
        try {
          await restoreAttachment(chatId, reservation);
        } catch (cleanupError) {
          pushToast(
            `The prompt failed and its attachment could not be restored: ${detail(cleanupError)}`,
            8000,
          );
        }
      }
      pushToast(`Could not send prompt: ${detail(error)}`, 8000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-6 pb-4 pt-2 shrink-0">
      <div className="glass-panel rounded-2xl px-3 py-2 flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void attach(file);
          }}
        />
        <button
          type="button"
          onClick={() => void chooseAttachment()}
          className="p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-muted-text hover:text-accent transition-colors shrink-0"
          aria-label="Attach PNG or JPEG"
          title="Attach PNG or JPEG"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0 flex flex-col">
          {draft && (
            <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-text">
              <span className="truncate max-w-[200px]">{draft.name}</span>
              <button
                type="button"
                onClick={() =>
                  void discardAttachment(chatId).catch((error) =>
                    pushToast(`Could not remove attachment: ${detail(error)}`),
                  )
                }
                className="hover:text-danger"
                aria-label="Remove attachment"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <textarea
            ref={textarea}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              const element = textarea.current;
              if (element) {
                element.style.height = "auto";
                element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
              }
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={16 * 1024}
            placeholder={
              draft
                ? "Describe how to edit this image…"
                : "Describe an image, or drop one to edit…"
            }
            aria-label="Prompt input"
            className="resize-none bg-transparent outline-none text-sm placeholder:text-muted-text max-h-[200px] leading-relaxed py-1.5"
          />
        </div>

        <button
          type="button"
          onClick={() => void send()}
          disabled={!value.trim() || busy}
          aria-busy={busy}
          aria-label="Generate image"
          title="Generate image"
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
