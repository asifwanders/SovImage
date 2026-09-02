"use client";

import { Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { useChats } from "@/lib/stores/chats";
import { useSetup } from "@/lib/stores/setup";
import { useToasts } from "@/lib/stores/toasts";

export function ChatHeader({ chatId }: { chatId: string }) {
  const chat = useChats((s) => s.chats.find((c) => c.id === chatId));
  const rename = useChats((s) => s.rename);
  const modelId = useSetup((s) => s.modelId);
  const pushToast = useToasts((s) => s.push);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat?.title ?? "");
  const editingFinished = useRef(false);
  const editGeneration = useRef(0);

  if (!chat) return null;

  const finishEdit = async (save: boolean) => {
    if (editingFinished.current) return;
    editingFinished.current = true;
    const title = draft.trim();
    const original = chat.title;
    const id = chat.id;
    const generation = editGeneration.current;
    setEditing(false);
    if (!save || !title || title === original) return;
    try {
      await rename(id, title);
    } catch (error) {
      if (editGeneration.current === generation) {
        editingFinished.current = false;
        setDraft(title);
        setEditing(true);
      }
      pushToast(
        `Could not rename chat: ${error instanceof Error ? error.message : String(error)}`,
        8000,
      );
    }
  };

  return (
    <header className="glass-soft border-b border-panel-border px-6 py-3 flex items-center gap-3 shrink-0">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {editing ? (
          <input
            autoFocus
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void finishEdit(true);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                void finishEdit(false);
              }
            }}
            onBlur={() => void finishEdit(true)}
            className="bg-transparent outline-none text-sm font-medium flex-1 min-w-0"
            aria-label="Chat title"
          />
        ) : (
          <button
            aria-label={`Rename chat ${chat.title}`}
            onClick={() => {
              editGeneration.current++;
              editingFinished.current = false;
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

    </header>
  );
}
