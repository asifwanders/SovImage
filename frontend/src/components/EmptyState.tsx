"use client";

import { Sparkles } from "lucide-react";
import { useChats } from "@/lib/stores/chats";
import { useRouter } from "next/navigation";

export function EmptyState() {
  const create = useChats((s) => s.create);
  const router = useRouter();

  const start = async () => {
    const c = await create("New chat");
    router.push(`/?chat=${c.id}`);
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-8">
      <div className="glass-panel rounded-2xl p-8 max-w-md w-full flex flex-col items-center gap-4 text-center">
        <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-accent" />
        </div>
        <h2 className="text-base font-semibold">Generate your first image</h2>
        <p className="text-xs text-muted-text">
          Start a new chat, write a prompt, optionally drop an image to edit.
          Everything runs locally on your machine.
        </p>
        <button
          onClick={start}
          className="bg-accent/10 text-accent hover:bg-accent/20 border border-accent/30 rounded-full px-4 py-1.5 text-xs font-medium transition-colors"
        >
          New chat
        </button>
      </div>
    </div>
  );
}
