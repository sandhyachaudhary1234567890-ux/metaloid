import React from 'react';
import type { PlatformArtifactPayload } from '../../lib/artifacts/artifactGenerator';
import { PresentationWorkspace } from './PresentationWorkspace';
import { DocumentWorkspace } from './DocumentWorkspace';
import { SpreadsheetWorkspace } from './SpreadsheetWorkspace';
import { MetaCodeWorkspace } from './MetaCodeWorkspace';
import { ResearchWorkspace } from './ResearchWorkspace';

export interface UnifiedWorkspacePanelProps {
  payload: PlatformArtifactPayload | null;
  onClose: () => void;
}

export function UnifiedWorkspacePanel({ payload, onClose }: UnifiedWorkspacePanelProps) {
  if (!payload) return null;

  switch (payload.kind) {
    case 'presentation':
      return <PresentationWorkspace deck={payload.data} onClose={onClose} />;
    case 'document':
      return <DocumentWorkspace doc={payload.data} onClose={onClose} />;
    case 'spreadsheet':
      return <SpreadsheetWorkspace sheet={payload.data} onClose={onClose} />;
    case 'code':
      return <MetaCodeWorkspace code={payload.data} onClose={onClose} />;
    case 'research':
      return <ResearchWorkspace research={payload.data} onClose={onClose} />;
    default:
      return null;
  }
}
