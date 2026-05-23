"use client";

import { useEffect } from "react";
import { useTheme } from "@/lib/stores/theme";

export function ThemeBootstrap() {
  const init = useTheme((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);
  return (
    <script
      // Avoid FOUC + sidebar width flash: apply theme class and a
      // `data-sidebar-collapsed` attribute on <html> before React hydrates.
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var t=localStorage.getItem('sovimage.theme');var sys=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=t==='dark'||t==='light'?t:(sys?'dark':'light');document.documentElement.classList.add(r);var c=localStorage.getItem('sovimage.sidebar.collapsed')==='true';document.documentElement.setAttribute('data-sidebar-collapsed',c?'1':'0');}catch(e){}})();`,
      }}
    />
  );
}
