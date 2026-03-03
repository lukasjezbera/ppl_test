"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Question, getShuffledSet, getCategories, getQuestionById } from "@/lib/questions";
import { getErrorQuestions } from "@/lib/prioritization";
import { recordAnswer } from "@/lib/scoring";
import QuestionImage from "@/components/QuestionImage";
import ExplanationChat from "@/components/ExplanationChat";

interface QuizResult {
  questionId: string;
  selectedIndex: number;
  correctIndex: number;
  isCorrect: boolean;
}

export default function QuizPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId: rawCategoryId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [results, setResults] = useState<QuizResult[]>([]);
  const [showExplanation, setShowExplanation] = useState(false);
  const [categoryName, setCategoryName] = useState("");

  useEffect(() => {
    const count = searchParams.get("count");
    const countNum = count ? parseInt(count) : undefined;
    const repeat = searchParams.get("repeat");
    const mode = searchParams.get("mode");

    let qs: Question[];

    if (repeat === "wrong") {
      // Repeat wrong answers from previous session
      try {
        const wrongIds = JSON.parse(
          sessionStorage.getItem("repeat-wrong") || "[]"
        ) as string[];
        qs = wrongIds
          .map((id) => getQuestionById(id))
          .filter((q): q is Question => q !== undefined);
        setCategoryName("Opakování špatných");
      } catch {
        qs = [];
      }
    } else if (mode === "errors") {
      // Error review for a specific category or all
      const catId = rawCategoryId === "mix" ? undefined : parseInt(rawCategoryId);
      qs = getErrorQuestions(catId);
      if (countNum) qs = qs.slice(0, countNum);
      const cat = catId ? getCategories().find((c) => c.id === catId) : undefined;
      setCategoryName(cat ? `Chyby — ${cat.name}` : "Opakování chyb");
    } else if (rawCategoryId === "errors") {
      qs = getErrorQuestions();
      if (countNum) qs = qs.slice(0, countNum);
      setCategoryName("Opakování chyb");
    } else if (rawCategoryId === "mix") {
      qs = getShuffledSet("mix", countNum);
      setCategoryName("Mix všech okruhů");
    } else {
      const catId = parseInt(rawCategoryId);
      qs = getShuffledSet(catId, countNum);
      const cat = getCategories().find((c) => c.id === catId);
      setCategoryName(cat?.name || `Okruh ${catId}`);
    }

    setQuestions(qs);
  }, [rawCategoryId, searchParams]);

  const currentQuestion = questions[currentIndex];
  const isAnswered = selectedAnswer !== null;
  const isCorrect = selectedAnswer === currentQuestion?.correctIndex;
  const isLastQuestion = currentIndex === questions.length - 1;

  const handleAnswer = useCallback(
    (index: number) => {
      if (isAnswered || !currentQuestion) return;
      setSelectedAnswer(index);
      const correct = index === currentQuestion.correctIndex;
      recordAnswer(currentQuestion.id, correct);
      setResults((prev) => [
        ...prev,
        {
          questionId: currentQuestion.id,
          selectedIndex: index,
          correctIndex: currentQuestion.correctIndex,
          isCorrect: correct,
        },
      ]);
    },
    [isAnswered, currentQuestion]
  );

  const handleNext = useCallback(() => {
    if (!isAnswered) return;
    if (isLastQuestion) {
      // Store results in sessionStorage and navigate to results
      const totalCorrect = [...results].filter((r) => r.isCorrect).length;
      const wrongQuestions = [...results]
        .filter((r) => !r.isCorrect)
        .map((r) => ({
          questionId: r.questionId,
          selectedIndex: r.selectedIndex,
          correctIndex: r.correctIndex,
        }));
      sessionStorage.setItem(
        "quiz-results",
        JSON.stringify({
          categoryId: rawCategoryId,
          categoryName,
          total: questions.length,
          correct: totalCorrect,
          wrong: wrongQuestions,
        })
      );
      router.push("/results");
    } else {
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    }
  }, [
    isAnswered,
    isLastQuestion,
    results,
    rawCategoryId,
    categoryName,
    questions.length,
    router,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture shortcuts when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key >= "1" && e.key <= "4" && !isAnswered) {
        handleAnswer(parseInt(e.key) - 1);
      } else if (e.key === "Enter" && isAnswered) {
        handleNext();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAnswered, handleAnswer, handleNext]);

  if (questions.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-white/60">Načítání otázek...</p>
      </main>
    );
  }

  if (!currentQuestion) {
    return null;
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.push("/")}
          className="text-white/50 hover:text-white transition-colors text-sm"
        >
          ← Dashboard
        </button>
        <span className="text-white/50 text-sm">{categoryName}</span>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-white/60 mb-2">
          <span>
            Otázka {currentIndex + 1} z {questions.length}
          </span>
          <span>
            {results.filter((r) => r.isCorrect).length} správně
          </span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{
              width: `${((currentIndex + (isAnswered ? 1 : 0)) / questions.length) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="bg-white/10 backdrop-blur border border-white/10 rounded-xl p-6 mb-6">
        <p className="text-white text-lg whitespace-pre-line leading-relaxed">
          {currentQuestion.question}
        </p>
        {currentQuestion.image && (
          <div className="mt-4">
            <QuestionImage
              src={`/images/${currentQuestion.image}`}
              alt={currentQuestion.image}
            />
          </div>
        )}
      </div>

      {/* Options */}
      <div className="space-y-3 mb-6">
        {currentQuestion.options.map((option, index) => {
          let bgClass = "bg-white/10 hover:bg-white/15 border-white/10";
          let indicator = "";

          if (isAnswered) {
            if (index === currentQuestion.correctIndex) {
              bgClass = "bg-correct/20 border-correct/50";
              indicator = " ✓";
            }
            if (
              index === selectedAnswer &&
              selectedAnswer !== currentQuestion.correctIndex
            ) {
              bgClass = "bg-incorrect/20 border-incorrect/50";
              indicator = " ✗";
            }
          }

          return (
            <button
              key={index}
              onClick={() => handleAnswer(index)}
              disabled={isAnswered}
              className={`w-full text-left p-4 rounded-xl border transition-all ${bgClass} ${
                !isAnswered ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-accent font-bold shrink-0">
                  {String.fromCharCode(65 + index)})
                </span>
                <span className="text-white whitespace-pre-line">
                  {option}
                  {indicator && (
                    <span
                      className={`ml-2 font-bold ${
                        indicator === " ✓"
                          ? "text-correct"
                          : "text-incorrect"
                      }`}
                    >
                      {indicator}
                    </span>
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Feedback area */}
      {isAnswered && (
        <div className="space-y-4">
          <div
            className={`text-center text-xl font-bold ${
              isCorrect ? "text-correct" : "text-incorrect"
            }`}
          >
            {isCorrect ? "Správně!" : "Špatně!"}
          </div>

          {/* Explanation chat */}
          {showExplanation ? (
            <ExplanationChat
              question={currentQuestion.question}
              options={currentQuestion.options}
              correctIndex={currentQuestion.correctIndex}
              selectedIndex={selectedAnswer!}
              image={currentQuestion.image}
            />
          ) : (
            <button
              onClick={() => setShowExplanation(true)}
              className="w-full bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl p-3 text-white/70 hover:text-white transition-all"
            >
              💡 Vysvětlit
            </button>
          )}

          {/* Next button */}
          <button
            onClick={handleNext}
            className="w-full bg-accent hover:bg-accent-hover text-white font-semibold py-4 rounded-xl transition-colors text-lg"
          >
            {isLastQuestion ? "Zobrazit výsledky" : "Další otázka →"}
          </button>

          <p className="text-center text-white/30 text-sm">
            Klávesy: 1-4 odpověď, Enter další
          </p>
        </div>
      )}
    </main>
  );
}
