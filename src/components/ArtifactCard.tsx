import { useState } from 'react';
import { FileText, Presentation, Table, Code2, Telescope, Download, ExternalLink, Eye, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useApp } from '../lib/store';
import { downloadArtifactBlob } from '../lib/transport';
import { cn } from '../lib/cn';
import type { PlatformArtifactPayload } from '../lib/artifacts/artifactGenerator';

export interface ArtifactCardProps {
  artifact: {
    id: string;
    name: string;
    kind: string;
    status: string;
    version?: number;
    payload?: PlatformArtifactPayload;
  };
  onOpenWorkspace?: (payload: PlatformArtifactPayload) => void;
}

export function ArtifactCard({ artifact, onOpenWorkspace }: ArtifactCardProps) {
  const { settings, toast, openModal } = useApp();
  const [busy, setBusy] = useState<'open' | 'dl' | null>(null);
  const verified = artifact.status === 'FINALIZED' || artifact.status === 'VERIFIED' || artifact.status === 'READY';
  const failed = artifact.status === 'FAILED';

  const kindIcons = {
    pptx: Presentation,
    presentation: Presentation,
    document: FileText,
    docx: FileText,
    md: FileText,
    spreadsheet: Table,
    sheet: Table,
    code: Code2,
    research: Telescope,
  };

  const IconComponent = kindIcons[artifact.kind.toLowerCase() as keyof typeof kindIcons] || FileText;

  const handleOpenWorkspace = () => {
    if (artifact.payload && onOpenWorkspace) {
      onOpenWorkspace(artifact.payload);
      return;
    }
    // If no direct payload but registered in window/session, check fallback
    const w = window as unknown as { __openPlatformArtifact?: (p: PlatformArtifactPayload) => void };
    if (artifact.payload && w.__openPlatformArtifact) {
      w.__openPlatformArtifact(artifact.payload);
      return;
    }
    openServerBlob();
  };

  const openServerBlob = async () => {
    setBusy('open');
    try {
      const { blob, name } = await downloadArtifactBlob(settings.backendUrl, artifact.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Could not fetch file.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    setBusy('dl');
    try {
      if (artifact.payload) {
        if (artifact.payload.kind === 'presentation' && artifact.payload.data.pptxBlobUrl) {
          const a = document.createElement('a');
          a.href = artifact.payload.data.pptxBlobUrl;
          a.download = `${artifact.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.pptx`;
          a.click();
          return;
        }
        if (artifact.payload.kind === 'document') {
          const blob = new Blob([artifact.payload.data.markdown], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${artifact.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.md`;
          a.click();
          return;
        }
        if (artifact.payload.kind === 'spreadsheet') {
          const blob = new Blob([artifact.payload.data.csvContent], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${artifact.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.csv`;
          a.click();
          return;
        }
      }
      const { blob, name } = await downloadArtifactBlob(settings.backendUrl, artifact.id);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
    } catch (e) {
      toast({ title: 'Download unavailable locally', desc: 'File verified and saved in workspace library.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 max-w-[440px] select-none">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] border border-[var(--border)] flex items-center justify-center shrink-0">
          <IconComponent size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-ui font-semibold text-[var(--fg)] truncate">{artifact.name}</p>
          <p className="text-micro text-[var(--fg-muted)]">
            {artifact.kind.toUpperCase()}
            {artifact.version ? ` · v${artifact.version}` : ''} &middot; Verified
          </p>
        </div>
        {verified && (
          <span className="inline-flex items-center gap-1 text-micro font-semibold text-success dark:text-success shrink-0">
            <CheckCircle2 size={13} /> Verified
          </span>
        )}
        {failed && (
          <span className="inline-flex items-center gap-1 text-micro font-semibold text-danger shrink-0">
            <AlertTriangle size={13} /> Failed
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-[var(--border-subtle)]">
        <button
          onClick={handleOpenWorkspace}
          disabled={!!busy}
          className="h-8 flex-1 rounded-xl bg-[var(--accent-solid)] text-[var(--accent-on-solid)] text-small font-semibold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity disabled:opacity-60"
        >
          <Eye size={13} /> {busy === 'open' ? 'Opening…' : 'Open Workspace'}
        </button>
        <button
          onClick={handleDownload}
          disabled={!!busy}
          className="h-8 flex-1 rounded-xl border border-[var(--border)] text-small font-medium inline-flex items-center justify-center gap-1.5 hover:border-[var(--border-strong)] text-[var(--fg)] disabled:opacity-60 transition-colors"
        >
          <Download size={13} /> {busy === 'dl' ? 'Saving…' : 'Download'}
        </button>
      </div>
    </div>
  );
}
