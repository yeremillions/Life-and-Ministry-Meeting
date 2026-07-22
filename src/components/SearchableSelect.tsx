import { useState, useRef, useEffect, useMemo } from "react";
import type { Assignee } from "../types";
import { privilegeLabel } from "../meeting";

export default function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "-- Select --",
  disabled = false,
  className = "",
  warningMessage = null,
}: {
  value?: number;
  options: Assignee[];
  onChange: (id: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  warningMessage?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const selected = useMemo(() => options.find((o) => o.id === value), [options, value]);

  const displayValue = useMemo(() => {
    if (isOpen) return query;
    if (selected) {
      const priv = privilegeLabel(selected);
      return priv ? `${selected.name} (${priv})` : selected.name;
    }
    return "";
  }, [isOpen, query, selected]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const nameMatch = o.name.toLowerCase().includes(q);
      const priv = privilegeLabel(o)?.toLowerCase() || "";
      const privMatch = priv.includes(q);
      return nameMatch || privMatch;
    });
  }, [options, query]);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          placeholder={selected ? undefined : placeholder}
          className={`w-full text-xs p-1.5 border rounded bg-white font-semibold text-slate-800 pr-6 select-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 ${
            disabled ? "bg-slate-100 text-slate-400 cursor-not-allowed" : ""
          } ${warningMessage ? "border-rose-300 ring-rose-300 focus:ring-rose-500 focus:border-rose-500" : "border-slate-300"}`}
          value={displayValue}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
              setQuery("");
            }
          }}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none text-slate-400">
          {value != null && !disabled && (
            <button
              type="button"
              className="pointer-events-auto hover:text-slate-600 font-bold p-0.5 text-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined);
                setQuery("");
                setIsOpen(false);
              }}
            >
              ✕
            </button>
          )}
          <span className="text-[10px]">▼</span>
        </div>
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-48 overflow-y-auto scrollbar-thin">
          {filteredOptions.length === 0 ? (
            <div className="p-2 text-xs text-slate-400 italic text-center">
              No matching brothers found
            </div>
          ) : (
            filteredOptions.map((o) => {
              const isSelected = o.id === value;
              const labelText = privilegeLabel(o);
              return (
                <button
                  key={o.id}
                  type="button"
                  className={`w-full text-left text-xs px-2.5 py-1.5 flex items-center justify-between hover:bg-slate-100 transition-colors ${
                    isSelected ? "bg-indigo-50 text-indigo-900 font-semibold" : "text-slate-700"
                  }`}
                  onClick={() => {
                    onChange(o.id);
                    setQuery("");
                    setIsOpen(false);
                  }}
                >
                  <span>{o.name}</span>
                  {labelText && (
                    <span className="pill bg-indigo-50 text-indigo-700 text-[9px] border border-indigo-100 font-bold px-1 py-0.25">
                      {labelText}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
