"use client";

import {
  ChevronLeft,
  ChevronRight,
  Info,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  MessageSquare,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/lib/stores/theme";
import { useChats } from "@/lib/stores/chats";
import { cn } from "@/lib/utils";
import { db } from "@/lib/db";
import type { SearchHit } from "@/lib/types";
import { ConfirmModal } from "./ConfirmModal";

const STORAGE_KEY_COLLAPSED = "sovimage.sidebar.collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  // Per-field selectors prevent the sidebar from re-rendering on every
  // per-step generation event that touches the messages map.
  const resolved = useTheme((s) => s.resolved);
  const toggle = useTheme((s) => s.toggle);

  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const load = useChats((s) => s.load);
  const create = useChats((s) => s.create);
  const rename = useChats((s) => s.rename);
  const remove = useChats((s) => s.remove);
  const setActive = useChats((s) => s.setActive);

  // Read the pre-hydration attribute set by ThemeBootstrap so the initial
  // render matches what the inline script already painted — no width flash.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.getAttribute("data-sidebar-collapsed") === "1";
  });
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  // Debounced FTS5 query against the messages full-text index. Runs alongside
  // the client-side title filter so the user gets both surfaces at once.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const driver = await db();
        const hits = await driver.search(q);
        if (!cancelled) setSearchHits(hits);
      } catch {
        if (!cancelled) setSearchHits([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY_COLLAPSED, String(next));
    document.documentElement.setAttribute(
      "data-sidebar-collapsed",
      next ? "1" : "0",
    );
  };

  const visibleChats = useMemo(() => {
    if (!query.trim()) return chats;
    const q = query.toLowerCase();
    return chats.filter((c) => c.title.toLowerCase().includes(q));
  }, [chats, query]);

  const newChat = async () => {
    const c = await create();
    router.push(`/?chat=${c.id}`);
  };

  const selectChat = async (id: string) => {
    await setActive(id);
    router.push(`/?chat=${id}`);
  };

  const startEdit = (id: string, current: string) => {
    setEditingId(id);
    setEditingTitle(current);
  };
  const commitEdit = async () => {
    if (editingId && editingTitle.trim()) {
      await rename(editingId, editingTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <div
      suppressHydrationWarning
      className={cn(
        "h-full glass-panel flex flex-col py-4 z-10 relative",
        "transition-[width] duration-200 ease-in-out",
        collapsed ? "w-14 px-1" : "w-64 px-3",
      )}
    >
      {/* Top: new chat + search */}
      <div className="flex flex-col gap-2 mb-3">
        <button
          onClick={newChat}
          title={collapsed ? "New chat" : undefined}
          className={cn(
            "group flex items-center rounded-lg transition-colors",
            "bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20",
            collapsed
              ? "justify-center px-2 py-2"
              : "gap-2 px-3 py-2 font-medium",
          )}
        >
          <Plus className="w-4 h-4 shrink-0" />
          {!collapsed && <span>New chat</span>}
        </button>

        {!collapsed && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-text" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              className="w-full glass-soft rounded-lg pl-7 pr-2 py-1.5 text-xs outline-none placeholder:text-muted-text focus:border-accent/50"
              aria-label="Search chats"
            />
          </div>
        )}
      </div>

      {/* Chat list */}
      <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 pr-1">
        {visibleChats.length === 0 && !collapsed && (
          <p className="text-muted-text text-xs px-2 py-2">No chats yet.</p>
        )}
        {visibleChats.map((c) => {
          const isActive = activeId === c.id;
          const isEditing = editingId === c.id;
          return (
            <div
              key={c.id}
              className={cn(
                "group flex items-center rounded-lg border-l-2 transition-colors min-w-0",
                isActive
                  ? "bg-accent/15 border-accent text-accent"
                  : "hover:bg-black/10 dark:hover:bg-white/10 border-transparent",
                collapsed ? "justify-center px-2 py-2" : "px-2 py-1.5",
              )}
            >
              <MessageSquare className="w-3.5 h-3.5 text-accent shrink-0" />
              {!collapsed && (
                <>
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={commitEdit}
                      className="ml-2 flex-1 bg-transparent outline-none text-xs min-w-0"
                      aria-label="Rename chat"
                    />
                  ) : (
                    <button
                      onClick={() => selectChat(c.id)}
                      className="ml-2 flex-1 text-left text-xs truncate min-w-0"
                    >
                      {c.title}
                    </button>
                  )}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isEditing ? (
                      <>
                        <button
                          onClick={commitEdit}
                          className="p-1 hover:text-accent"
                          aria-label="Save"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 hover:text-danger"
                          aria-label="Cancel"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(c.id, c.title)}
                          className="p-1 hover:text-accent"
                          aria-label="Rename"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(c.id)}
                          className="p-1 hover:text-danger"
                          aria-label="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {!collapsed && searchHits.length > 0 && (
          <div className="mt-3 pt-3 border-t border-panel-border flex flex-col gap-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-text px-2 pb-1">
              Search results
            </p>
            {searchHits.map((hit) => {
              const title =
                chats.find((c) => c.id === hit.chatId)?.title ?? "—";
              return (
                <button
                  key={hit.messageId}
                  onClick={async () => {
                    await setActive(hit.chatId);
                    router.push(
                      `/?chat=${hit.chatId}&msg=${hit.messageId}`,
                    );
                  }}
                  className="text-left rounded-lg px-2 py-1.5 hover:bg-accent/10 transition-colors min-w-0"
                >
                  <div className="text-xs truncate text-foreground">
                    {title}
                  </div>
                  <div
                    className="text-[11px] text-muted-text line-clamp-2 break-words [&_b]:text-accent [&_b]:font-medium"
                    dangerouslySetInnerHTML={{ __html: hit.snippet }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </nav>

      {/* Bottom utilities */}
      <div className="mt-3 pt-3 border-t border-panel-border flex flex-col gap-0.5">
        <button
          onClick={toggle}
          title={collapsed ? "Toggle theme" : undefined}
          className={cn(
            "group flex items-center rounded-lg transition-colors text-foreground hover:bg-black/10 dark:hover:bg-white/10",
            collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
          )}
        >
          {resolved === "dark" ? (
            <Sun className="w-4 h-4 text-accent shrink-0" />
          ) : (
            <Moon className="w-4 h-4 text-accent shrink-0" />
          )}
          {!collapsed && (
            <span className="text-xs font-medium">
              {resolved === "dark" ? "Light mode" : "Dark mode"}
            </span>
          )}
        </button>

        <Link
          href="/settings"
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "group flex items-center rounded-lg transition-colors text-foreground hover:bg-black/10 dark:hover:bg-white/10",
            pathname === "/settings" &&
              "bg-accent/15 text-accent border-l-2 border-accent",
            collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
          )}
        >
          <Settings className="w-4 h-4 text-accent shrink-0" />
          {!collapsed && <span className="text-xs font-medium">Settings</span>}
        </Link>

        <Link
          href="/about"
          title={collapsed ? "About" : undefined}
          className={cn(
            "group flex items-center rounded-lg transition-colors text-foreground hover:bg-black/10 dark:hover:bg-white/10",
            pathname === "/about" &&
              "bg-accent/15 text-accent border-l-2 border-accent",
            collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
          )}
        >
          <Info className="w-4 h-4 text-accent shrink-0" />
          {!collapsed && <span className="text-xs font-medium">About</span>}
        </Link>

        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "group flex items-center rounded-lg transition-colors text-muted-text hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10 mt-1",
            collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
          )}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 shrink-0" />
          ) : (
            <ChevronLeft className="w-4 h-4 shrink-0" />
          )}
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
      </div>

      <ConfirmModal
        open={confirmDelete !== null}
        title="Delete chat?"
        message="This permanently removes the chat and all generated images inside it."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await remove(confirmDelete);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
