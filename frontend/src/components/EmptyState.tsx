"use client";

import { Sparkles } from "lucide-react";
import { useChats } from "@/lib/stores/chats";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToasts } from "@/lib/stores/toasts";

export function EmptyState() {
  const create = useChats((s) => s.create);
  const hasChats = useChats((s) => s.chats.length > 0);
  const router = useRouter();
  const pushToast = useToasts((state) => state.push);
  const [creating, setCreating] = useState(false);

  const start = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const c = await create("New chat");
      router.push(`/?chat=${c.id}`);
    } catch (error) {
      pushToast(
        `Could not create chat: ${error instanceof Error ? error.message : String(error)}`,
        8000,
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-8">
      <div className="glass-panel rounded-2xl p-8 max-w-md w-full flex flex-col items-center gap-4 text-center">
        <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-accent" />
        </div>
        <h2 className="text-base font-semibold">
          {hasChats ? "Select a chat or start a new one" : "Generate your first image"}
        </h2>
        <p className="text-xs text-muted-text">
          {hasChats
            ? "Choose an existing chat from the sidebar, or create another."
            : "Start a new chat, write a prompt, optionally drop an image to edit. Inference runs locally on your machine."}
        </p>
        <button
          type="button"
          onClick={() => void start()}
          disabled={creating}
          className="bg-accent/10 text-accent hover:bg-accent/20 border border-accent/30 rounded-full px-4 py-1.5 text-xs font-medium transition-colors"
        >
          New chat
        </button>
      </div>
    </div>
  );
}
