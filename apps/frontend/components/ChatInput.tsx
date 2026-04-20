'use client';

import { useState, useRef } from 'react';

interface Props {
  onSubmit: (prompt: string) => void;
  loading: boolean;
}

export function ChatInput({ onSubmit, loading }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed.length < 10 || loading) return;
    onSubmit(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want to build…"
        disabled={loading}
        rows={3}
      />
      <div className="row">
        <span className="hint">⌘↵ to submit · {value.length}/10000</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={loading || value.trim().length < 10}
        >
          {loading ? <span className="spinner" /> : null}
          {loading ? 'Building…' : 'Generate'}
        </button>
      </div>
    </div>
  );
}
