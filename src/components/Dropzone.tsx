import { useRef, useState, type DragEvent } from 'react';

interface Props {
  onFile: (file: File) => void;
  onSample: () => void;
  busy: boolean;
}

const ACCEPT = '.csv,.tsv,.txt,.parquet,.pq,.json,.jsonl,.ndjson,.xlsx';

export default function Dropzone({ onFile, onSample, busy }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !busy) onFile(file);
  };

  return (
    <div
      className={`dropzone${over ? ' over' : ''}${busy ? ' busy' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
        <path fill="currentColor" d="M12 3 7 8h3v6h4V8h3l-5-5ZM5 18v-3H3v5h18v-5h-2v3H5Z" />
      </svg>
      <p className="dz-title">Drag &amp; drop a file here</p>
      <p className="dz-sub">CSV, TSV, Parquet, JSON / NDJSON or Excel (.xlsx)</p>
      <div className="dz-actions">
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}>
          Choose file
        </button>
        <button className="btn ghost" disabled={busy} onClick={onSample}>
          Try a sample dataset
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
