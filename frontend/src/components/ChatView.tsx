"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useChats } from "@/lib/stores/chats";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { DropOverlay } from "./DropOverlay";
import { EmptyState } from "./EmptyState";

function ChatViewInner() {
  const params = useSearchParams();
  const chatIdParam = params.get("chat");
  const msgIdParam = params.get("msg");
  const activeId = useChats((s) => s.activeId);
  const setActive = useChats((s) => s.setActive);

  useEffect(() => {
    if (chatIdParam && chatIdParam !== activeId) {
      setActive(chatIdParam);
    } else if (!chatIdParam && activeId) {
      setActive(null);
    }
  }, [chatIdParam, activeId, setActive]);

  if (!activeId) return <EmptyState />;

  return (
    <div className="h-full flex flex-col relative">
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
