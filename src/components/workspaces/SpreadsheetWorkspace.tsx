import React, { useState } from 'react';
import { Table, Download, Search, Maximize2, Minimize2, ArrowUpDown } from 'lucide-react';
import type { SpreadsheetData } from '../../lib/artifacts/artifactGenerator';

export interface SpreadsheetWorkspaceProps {
  sheet: SpreadsheetData;
  onClose: () => void;
}

export function SpreadsheetWorkspace({ sheet, onClose }: SpreadsheetWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const filteredRows = sheet.rows.filter((row) =>
    row.some((cell) => String(cell).toLowerCase().includes(query.toLowerCase()))
  );

  const handleDownloadCsv = () => {
    const blob = new Blob([sheet.csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sheet.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className={`flex flex-col h-full bg-[var(--surface)] text-[var(--fg)] border-l border-[var(--border)] ${isFullscreen ? 'fixed inset-0 z-50' : 'relative'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-elevated)_60%,transparent)] backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] flex items-center justify-center shrink-0">
            <Table size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="text-ui font-semibold text-[var(--fg)] truncate">{sheet.title}</h3>
            <p className="text-micro text-[var(--fg-muted)]">
              {sheet.rows.length} rows &middot; {sheet.columns.length} columns &middot; Spreadsheet Workspace
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDownloadCsv}
            className="btn-primary h-8 px-3 text-xs rounded-lg inline-flex items-center gap-1.5"
          >
            <Download size={13} /> Export CSV
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="icon-btn w-8 h-8 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            className="icon-btn w-8 h-8 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)] ml-1"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Summary KPI Bar */}
      {sheet.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-[color-mix(in_srgb,var(--surface-sunken)_40%,transparent)] border-b border-[var(--border)] text-xs">
          {Object.entries(sheet.summary).map(([k, v]) => (
            <div key={k} className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <span className="text-micro text-[var(--fg-muted)] uppercase tracking-wider block font-medium">
                {k}
              </span>
              <span className="text-sm font-semibold text-[var(--fg)] mt-0.5 block">{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Search Filter */}
      <div className="p-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center gap-2">
        <Search size={14} className="text-[var(--fg-muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows by keyword…"
          className="bg-transparent text-xs outline-none flex-1 text-[var(--fg)] placeholder:text-[var(--fg-muted)]"
        />
      </div>

      {/* Table Body */}
      <div className="flex-1 overflow-auto p-4 bg-[var(--bg)]">
        <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--surface)] shadow-sm">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg-secondary)] font-medium">
                {sheet.columns.map((col, i) => (
                  <th key={i} className="px-3.5 py-2.5 font-semibold">
                    <span className="inline-flex items-center gap-1">
                      {col} <ArrowUpDown size={11} className="text-[var(--fg-muted)] opacity-60" />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-[var(--surface-hover)] transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2.5 text-[var(--fg)] font-mono">
                      {typeof cell === 'number' ? cell.toLocaleString() : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
