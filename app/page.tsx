"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getCategories, getAllQuestions } from "@/lib/questions";
import {
  getCategoryStats,
  getOverallStats,
  hasErrors,
  resetCategoryStats,
  resetCategoryErrors,
  resetAllStats,
  resetAllErrors,
} from "@/lib/scoring";
import { getErrorCount } from "@/lib/prioritization";

export default function Dashboard() {
  const router = useRouter();
  const categories = getCategories();
  const totalQuestions = getAllQuestions().length;
  const overall = getOverallStats();
  const showErrors = hasErrors();
  const [selectedCategory, setSelectedCategory] = useState<
    number | "mix" | "errors" | null
  >(null);
  const [refreshKey, setRefreshKey] = useState(0);
  void refreshKey; // used to trigger re-render after reset

  function handleResetCategoryStats(categoryId: number) {
    if (!confirm("Opravdu chceš smazat skóre pro tento okruh?")) return;
    resetCategoryStats(categoryId);
    setRefreshKey((k) => k + 1);
  }

  function handleResetCategoryErrors(categoryId: number) {
    if (!confirm("Opravdu chceš smazat chybné odpovědi pro tento okruh?")) return;
    resetCategoryErrors(categoryId);
    setRefreshKey((k) => k + 1);
  }

  function handleResetAllStats() {
    if (!confirm("Opravdu chceš smazat skóre pro všechny okruhy?")) return;
    resetAllStats();
    setRefreshKey((k) => k + 1);
  }

  function handleResetAllErrors() {
    if (!confirm("Opravdu chceš smazat chybné odpovědi pro všechny okruhy?")) return;
    resetAllErrors();
    setRefreshKey((k) => k + 1);
  }

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
          const errorCount = getErrorCount(cat.id);
          return (
            <div
              key={cat.id}
              className="bg-white/10 backdrop-blur border border-white/10 rounded-xl p-5 text-left"
            >
              <button
                onClick={() => handleCategoryClick(cat.id)}
                className="w-full text-left transition-all hover:opacity-80"
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
              {errorCount > 0 && (
                <button
                  onClick={() => router.push(`/quiz/${cat.id}?mode=errors`)}
                  className="mt-3 text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  Opakovat chyby ({errorCount})
                </button>
              )}
              {stats.totalAnswered > 0 && (
                <div className="flex gap-3 mt-2">
                  <button
                    onClick={() => handleResetCategoryStats(cat.id)}
                    className="text-xs text-white/30 hover:text-white/60 transition-colors"
                  >
                    🗑️ Resetovat skóre
                  </button>
                  {stats.totalWrong > 0 && (
                    <button
                      onClick={() => handleResetCategoryErrors(cat.id)}
                      className="text-xs text-white/30 hover:text-white/60 transition-colors"
                    >
                      🔄 Resetovat chyby
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Mix all */}
        <div className="bg-accent/20 border border-accent/30 rounded-xl p-5 text-left">
          <button
            onClick={() => handleCategoryClick("mix")}
            className="w-full text-left transition-all hover:opacity-80"
          >
            <div className="flex items-start justify-between mb-2">
              <span className="text-accent font-bold text-lg">Mix</span>
              <span className="text-white/40 text-sm">
                {totalQuestions} otázek
              </span>
            </div>
            <h3 className="font-semibold text-white">Mix všech okruhů</h3>
          </button>
          {getErrorCount() > 0 && (
            <button
              onClick={() => router.push("/quiz/mix?mode=errors")}
              className="mt-3 text-sm text-accent hover:text-accent-hover transition-colors"
            >
              Opakovat chyby ({getErrorCount()})
            </button>
          )}
          {overall.totalAnswered > 0 && (
            <div className="flex gap-3 mt-2">
              <button
                onClick={handleResetAllStats}
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                🗑️ Resetovat skóre
              </button>
              {showErrors && (
                <button
                  onClick={handleResetAllErrors}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  🔄 Resetovat chyby
                </button>
              )}
            </div>
          )}
        </div>

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
