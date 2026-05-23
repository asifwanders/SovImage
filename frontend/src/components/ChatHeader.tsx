"use client";

import { MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
import { useChats } from "@/lib/stores/chats";
import { useSetup } from "@/lib/stores/setup";

export function ChatHeader({ chatId }: { chatId: string }) {
  const chat = useChats((s) => s.chats.find((c) => c.id === chatId));
  const rename = useChats((s) => s.rename);
  const modelId = useSetup((s) => s.modelId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat?.title ?? "");

  if (!chat) return null;

  const commit = async () => {
    if (draft.trim() && draft.trim() !== chat.title) {
      await rename(chat.id, draft.trim());
    }
    setEditing(false);
  };

  return (
    <header className="glass-soft border-b border-panel-border px-6 py-3 flex items-center gap-3 shrink-0">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={commit}
            className="bg-transparent outline-none text-sm font-medium flex-1 min-w-0"
            aria-label="Chat title"
          />
        ) : (
          <button
            onClick={() => {
              setDraft(chat.title);
              setEditing(true);
            }}
            className="group flex items-center gap-1.5 text-sm font-medium hover:text-accent transition-colors"
          >
            <span className="truncate">{chat.title}</span>
            <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
          </button>
        )}
      </div>

      {modelId && (
        <span className="text-[10px] uppercase tracking-wider text-muted-text glass-soft rounded-full px-2 py-0.5">
          {modelId}
        </span>
      )}

      <button
        className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        aria-label="More"
      >
        <MoreHorizontal className="w-4 h-4 text-muted-text" />
      </button>
    </header>
  );
}
