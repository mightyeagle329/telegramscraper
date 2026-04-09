"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function StatusBar() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        await api.health();
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`w-2 h-2 rounded-full ${
          connected === null
            ? "bg-yellow-500"
            : connected
            ? "bg-accent-green"
            : "bg-accent-red"
        }`}
      />
      <span className="text-text-muted">
        {connected === null
          ? "Connecting..."
          : connected
          ? "Backend Connected"
          : "Backend Offline"}
      </span>
    </div>
  );
}
