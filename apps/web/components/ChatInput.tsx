'use client';

import { useState } from 'react';

interface ChatInputProps {
  onSubmit: (prompt: string) => Promise<void>;
  loading: boolean;
}

export function ChatInput({ onSubmit, loading }: ChatInputProps) {
  const [value, setValue] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt || loading) return;
    await onSubmit(prompt);
  };

  return (
    <form className="chat-input" onSubmit={submit}>
      <div className="chat-input__head">
        <span className="eyebrow">Prompt</span>
        <span className="chat-input__hint">Shift+Enter for newline</span>
      </div>

      <textarea
        className="chat-input__textarea"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Describe what you want the agent team to build..."
        rows={6}
      />

      <div className="chat-input__actions">
        <button className="btn btn-primary" disabled={loading || !value.trim()} type="submit">
          {loading ? 'Generating...' : 'Generate Project'}
        </button>
      </div>
    </form>
  );
}
