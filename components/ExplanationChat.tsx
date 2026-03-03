"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ExplanationChatProps {
  question: string;
  options: string[];
  correctIndex: number;
  selectedIndex: number;
  image?: string;
}

export default function ExplanationChat({
  question,
  options,
  correctIndex,
  selectedIndex,
  image,
}: ExplanationChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function fetchExplanation(history: ChatMessage[]) {
    setLoading(true);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options,
          correctIndex,
          selectedIndex,
          image,
          history: history.length > 0 ? history : undefined,
        }),
      });
      const data = await res.json();
      const reply = data.explanation || data.error || "Chyba při získávání odpovědi.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Nepodařilo se získat odpověď." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Initial explanation
  useEffect(() => {
    if (!initialLoaded) {
      setInitialLoaded(true);
      fetchExplanation([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    fetchExplanation(newMessages);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSend();
    }
  }

  return (
    <div className="bg-white/10 border border-white/10 rounded-xl overflow-hidden">
      {/* Messages */}
      <div ref={scrollRef} className="max-h-[400px] overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-accent/20 text-accent border border-accent/30 whitespace-pre-line"
                  : "bg-white/5 text-white/80"
              }`}
            >
              {msg.role === "assistant" ? (
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/5 rounded-xl px-4 py-2.5 text-sm text-white/40">
              Přemýšlím...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      {messages.length > 0 && !loading && (
        <div className="border-t border-white/10 p-3 flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Zeptej se na cokoliv k této otázce..."
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-4 py-2 bg-accent/20 hover:bg-accent/30 text-accent text-sm font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-default shrink-0"
          >
            Odeslat
          </button>
        </div>
      )}
    </div>
  );
}
