"use client";

import { useEffect, useRef } from "react";
import { useChats } from "@/lib/stores/chats";
import { Bubble } from "./Bubble";
import type { Message } from "@/lib/types";

// Stable empty so the selector returns a referentially-equal value while
// the chat's messages haven't loaded yet. Inline `?? []` would create a
// fresh array on every store mutation and force re-renders.
const EMPTY_MESSAGES: Message[] = [];

export function MessageList({
  chatId,
  scrollToMessageId,
}: {
  chatId: string;
  scrollToMessageId?: string;
}) {
  const messages = useChats((s) => s.messages[chatId] ?? EMPTY_MESSAGES);
  const ref = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const nearBottom = useRef(true);

  useEffect(() => {
    nearBottom.current = true;
  }, [chatId]);

  // Trigger on length AND on the last message's status — the pending→done
  // transition is in-place (length unchanged) but inserts a real image
  // that should pull the viewport down with it.
  const last = messages[messages.length - 1];
  const scrollKey = `${messages.length}:${last?.status ?? ""}:${last?.imagePath ?? ""}`;
  useEffect(() => {
    // Don't auto-scroll to bottom when we're trying to land on a specific
    // message from a search hit.
    if (scrollToMessageId) return;
    if (!nearBottom.current) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [scrollKey, chatId, scrollToMessageId]);

  // Targeted scroll for deep-links from the FTS search results.
  useEffect(() => {
    if (!scrollToMessageId) return;
    const node = bubbleRefs.current.get(scrollToMessageId);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollToMessageId, messages.length]);

  useEffect(() => {
    const handle = (event: Event) => {
      const messageId = (event as CustomEvent<string>).detail;
      bubbleRefs.current
        .get(messageId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("sovimage:scroll-message", handle);
    return () => window.removeEventListener("sovimage:scroll-message", handle);
  }, []);

  const registerRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) bubbleRefs.current.set(id, el);
    else bubbleRefs.current.delete(id);
  };

  return (
    <div
      ref={ref}
      onScroll={(event) => {
        const element = event.currentTarget;
        nearBottom.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
      }}
      className="flex-1 min-h-0 overflow-y-auto px-6 py-6 flex flex-col gap-4"
    >
      {messages.map((m) => (
        <Bubble key={m.id} message={m} ref={registerRef(m.id)} />
      ))}
    </div>
  );
}
