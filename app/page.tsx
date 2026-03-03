"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getCategories, getAllQuestions } from "@/lib/questions";
import { getCategoryStats, getOverallStats, hasErrors } from "@/lib/scoring";

export default function Dashboard() {
  const router = useRouter();
  const categories = getCategories();
  const totalQuestions = getAllQuestions().length;
  const overall = getOverallStats();
  const showErrors = hasErrors();
  const [selectedCategory, setSelectedCategory] = useState<
    number | "mix" | "errors" | null
  >(null);

  function handleCategoryClick(id: number | "mix" | "errors") {
    setSelectedCategory(id);
  }

  function handleCountSelect(count: number | "all") {
    if (!selectedCategory) return;
    const params = new URLSearchParams();
    if (count !== "all") params.set("count", String(count));
    router.push(`/quiz/${selectedCategory}?${params.toString()}`);
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">
          PPL Quiz Trainer
        </h1>
        <p className="text-white/60">Příprava na zkoušku PPL — ÚCL ČR</p>
        {overall.percentage >= 0 && (
          <p className="text-white/40 text-sm mt-2">
            Celkově: {overall.percentage}% ({overall.totalCorrect}/
            {overall.totalAnswered})
          </p>
        )}
      </div>

      {/* Category selection modal */}
      {selectedCategory !== null && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedCategory(null)}
        >
          <div
            className="bg-white text-card-foreground rounded-xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg mb-4">Počet otázek</h3>
            <div className="grid grid-cols-2 gap-3">
              {[10, 20, 50].map((n) => (
                <button
                  key={n}
                  onClick={() => handleCountSelect(n)}
                  className="bg-accent hover:bg-accent-hover text-white font-semibold py-3 rounded-lg transition-colors"
                >
                  {n} otázek
                </button>
              ))}
              <button
                onClick={() => handleCountSelect("all")}
                className="bg-accent hover:bg-accent-hover text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Všechny
              </button>
            </div>
            <button
              onClick={() => setSelectedCategory(null)}
              className="w-full mt-3 py-2 text-gray-500 hover:text-gray-700 transition-colors"
            >
              Zrušit
            </button>
          </div>
        </div>
      )}

      {/* Category cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {categories.map((cat) => {
          const stats = getCategoryStats(cat.id);
          return (
            <button
              key={cat.id}
              onClick={() => handleCategoryClick(cat.id)}
              className="bg-white/10 hover:bg-white/15 backdrop-blur border border-white/10 rounded-xl p-5 text-left transition-all hover:scale-[1.02]"
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-accent font-bold text-lg">
                  {cat.id}.
                </span>
                <span className="text-white/40 text-sm">
                  {cat.questionCount} otázek
                </span>
              </div>
              <h3 className="font-semibold text-white mb-3">{cat.name}</h3>
              {stats.percentage >= 0 && (
                <div>
                  <div className="flex justify-between text-sm text-white/60 mb-1">
                    <span>Úspěšnost</span>
                    <span>{stats.percentage}%</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${stats.percentage}%`,
                        backgroundColor:
                          stats.percentage >= 75
                            ? "#22C55E"
                            : stats.percentage >= 50
                              ? "#F59E0B"
                              : "#EF4444",
                      }}
                    />
                  </div>
                </div>
              )}
            </button>
          );
        })}

        {/* Mix all */}
        <button
          onClick={() => handleCategoryClick("mix")}
          className="bg-accent/20 hover:bg-accent/30 border border-accent/30 rounded-xl p-5 text-left transition-all hover:scale-[1.02]"
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-accent font-bold text-lg">Mix</span>
            <span className="text-white/40 text-sm">
              {totalQuestions} otázek
            </span>
          </div>
          <h3 className="font-semibold text-white">Mix všech okruhů</h3>
        </button>

        {/* Error review */}
        {showErrors && (
          <button
            onClick={() => handleCategoryClick("errors")}
            className="bg-incorrect/20 hover:bg-incorrect/30 border border-incorrect/30 rounded-xl p-5 text-left transition-all hover:scale-[1.02]"
          >
            <div className="flex items-start justify-between mb-2">
              <span className="text-incorrect font-bold text-lg">!</span>
            </div>
            <h3 className="font-semibold text-white">Opakování chyb</h3>
            <p className="text-white/50 text-sm mt-1">
              Otázky, kde jsi odpověděl špatně
            </p>
          </button>
        )}
      </div>
    </main>
  );
}
