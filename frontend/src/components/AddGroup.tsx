"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface AddGroupProps {
  onGroupAdded: () => void;
}

export default function AddGroup({ onGroupAdded }: AddGroupProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAdd = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");

    try {
      await api.addGroup(url.trim());
      setUrl("");
      onGroupAdded();
    } catch (e: any) {
      setError(e.message || "Failed to add group");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card-bg border border-card-border rounded-xl p-6 mb-6">
      <h2 className="text-lg font-semibold mb-4">Add New Group</h2>
      <div className="flex gap-3">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="https://t.me/group_name or invite link"
          className="flex-1 bg-background border border-card-border rounded-lg px-4 py-3 text-foreground placeholder:text-text-muted focus:outline-none focus:border-accent-purple transition-colors"
        />
        <button
          onClick={handleAdd}
          disabled={loading || !url.trim()}
          className="bg-accent-purple hover:bg-accent-purple/80 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap"
        >
          {loading ? "Adding..." : "+ Add"}
        </button>
      </div>
      {error && <p className="text-accent-red text-sm mt-2">{error}</p>}
    </div>
  );
}
