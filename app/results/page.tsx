"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getQuestionById } from "@/lib/questions";
import { recordSession } from "@/lib/scoring";
import QuestionImage from "@/components/QuestionImage";

interface WrongAnswer {
  questionId: string;
  selectedIndex: number;
  correctIndex: number;
}

interface QuizResults {
  categoryId: string;
  categoryName: string;
  total: number;
  correct: number;
  wrong: WrongAnswer[];
}

export default function ResultsPage() {
  const router = useRouter();
  const [results, setResults] = useState<QuizResults | null>(null);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [loadingExplanation, setLoadingExplanation] = useState<string | null>(
    null
  );

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("quiz-results");
      if (raw) {
        const data = JSON.parse(raw) as QuizResults;
        setResults(data);
        // Record the session
        const catId =
          data.categoryId === "mix"
            ? "mix"
            : data.categoryId === "errors"
              ? "errors"
              : parseInt(data.categoryId);
        recordSession(
          catId as number | "mix" | "errors",
          data.total,
          data.correct
        );
      }
    } catch {
      // invalid data
    }
  }, []);

  async function handleExplain(wrong: WrongAnswer) {
    if (loadingExplanation) return;
    const q = getQuestionById(wrong.questionId);
    if (!q) return;

    setLoadingExplanation(wrong.questionId);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q.question,
          options: q.options,
          correctIndex: wrong.correctIndex,
          selectedIndex: wrong.selectedIndex,
        }),
      });
      const data = await res.json();
      setExplanations((prev) => ({
        ...prev,
        [wrong.questionId]: data.explanation || data.error,
      }));
    } catch {
      setExplanations((prev) => ({
        ...prev,
        [wrong.questionId]: "Nepodařilo se získat vysvětlení.",
      }));
    } finally {
      setLoadingExplanation(null);
    }
  }

  if (!results) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/60 mb-4">Žádné výsledky</p>
          <button
            onClick={() => router.push("/")}
            className="bg-accent hover:bg-accent-hover text-white font-semibold py-3 px-6 rounded-xl transition-colors"
          >
            Zpět na Dashboard
          </button>
        </div>
      </main>
    );
  }

  const percentage = Math.round((results.correct / results.total) * 100);
  const wrongCount = results.total - results.correct;

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto">
      {/* Score */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white/60 mb-4">
          {results.categoryName}
        </h1>
        <div
          className={`text-7xl md:text-8xl font-bold mb-2 ${
            percentage >= 75
              ? "text-correct"
              : percentage >= 50
                ? "text-accent"
                : "text-incorrect"
          }`}
        >
          {percentage}%
        </div>
        <p className="text-white/60 text-lg">
          {results.correct} správně / {wrongCount} špatně / {results.total}{" "}
          celkem
        </p>
      </div>

      {/* Wrong answers */}
      {results.wrong.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 text-incorrect">
            Špatné odpovědi ({results.wrong.length})
          </h2>
          <div className="space-y-3">
            {results.wrong.map((wrong) => {
              const q = getQuestionById(wrong.questionId);
              if (!q) return null;
              return (
                <div
                  key={wrong.questionId}
                  className="bg-white/10 border border-white/10 rounded-xl p-4"
                >
                  <p className="text-white font-medium mb-2 whitespace-pre-line">
                    {q.question.length > 150
                      ? q.question.slice(0, 150) + "..."
                      : q.question}
                  </p>
                  {q.image && (
                    <div className="mb-2">
                      <QuestionImage
                        src={`/images/${q.image}`}
                        alt={q.image}
                      />
                    </div>
                  )}
                  <div className="text-sm space-y-1 mb-3">
                    <p className="text-incorrect">
                      Tvoje: {String.fromCharCode(65 + wrong.selectedIndex)}) {q.options[wrong.selectedIndex]?.slice(0, 80)}
                    </p>
                    <p className="text-correct">
                      Správně: {String.fromCharCode(65 + wrong.correctIndex)}) {q.options[wrong.correctIndex]?.slice(0, 80)}
                    </p>
                  </div>

                  {explanations[wrong.questionId] ? (
                    <p className="text-white/70 text-sm bg-white/5 rounded-lg p-3">
                      {explanations[wrong.questionId]}
                    </p>
                  ) : (
                    <button
                      onClick={() => handleExplain(wrong)}
                      disabled={loadingExplanation === wrong.questionId}
                      className="text-sm text-accent hover:text-accent-hover transition-colors"
                    >
                      {loadingExplanation === wrong.questionId
                        ? "Načítání..."
                        : "💡 Vysvětlit"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="space-y-3">
        {results.wrong.length > 0 && (
          <button
            onClick={() => {
              const wrongIds = results.wrong.map((w) => w.questionId);
              sessionStorage.setItem(
                "repeat-wrong",
                JSON.stringify(wrongIds)
              );
              router.push(`/quiz/${results.categoryId}?repeat=wrong`);
            }}
            className="w-full bg-incorrect/20 hover:bg-incorrect/30 border border-incorrect/30 text-white font-semibold py-4 rounded-xl transition-colors"
          >
            Opakovat špatné ({results.wrong.length})
          </button>
        )}
        <button
          onClick={() => router.push(`/quiz/${results.categoryId}`)}
          className="w-full bg-accent hover:bg-accent-hover text-white font-semibold py-4 rounded-xl transition-colors"
        >
          Nový test
        </button>
        <button
          onClick={() => router.push("/")}
          className="w-full bg-white/10 hover:bg-white/15 border border-white/10 text-white font-semibold py-4 rounded-xl transition-colors"
        >
          Dashboard
        </button>
      </div>
    </main>
  );
}
