"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useChats } from "@/lib/stores/chats";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { DropOverlay } from "./DropOverlay";
import { EmptyState } from "./EmptyState";
import { useToasts } from "@/lib/stores/toasts";

function ChatViewInner() {
  const params = useSearchParams();
  const router = useRouter();
  const chatIdParam = params.get("chat");
  const msgIdParam = params.get("msg");
  const activeId = useChats((s) => s.activeId);
  const setActive = useChats((s) => s.setActive);
  const pushToast = useToasts((s) => s.push);

  useEffect(() => {
    if (chatIdParam && chatIdParam !== activeId) {
      void setActive(chatIdParam).catch((error) => {
        pushToast(
          `Could not open chat: ${error instanceof Error ? error.message : String(error)}`,
          8000,
        );
        router.replace("/");
      });
    } else if (!chatIdParam && activeId) {
      void setActive(null);
    }
  }, [chatIdParam, activeId, pushToast, router, setActive]);

  if (chatIdParam && activeId !== chatIdParam) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="h-full flex items-center justify-center text-sm text-muted-text"
      >
        Loading chat…
      </div>
    );
  }
  if (!activeId) return <EmptyState />;

  return (
    <div key={activeId} className="h-full flex flex-col relative">
      <ChatHeader chatId={activeId} />
      <MessageList
        chatId={activeId}
        scrollToMessageId={msgIdParam ?? undefined}
      />
      <Composer chatId={activeId} />
      <DropOverlay chatId={activeId} />
    </div>
  );
}

export function ChatView() {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <ChatViewInner />
    </Suspense>
  );
}
