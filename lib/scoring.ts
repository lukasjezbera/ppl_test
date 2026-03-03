const STORAGE_KEY = "ppl-quiz-scores";

export interface QuestionStats {
  correct: number;
  wrong: number;
  last: string;
}

export interface SessionRecord {
  date: string;
  categoryId: number | "mix" | "errors";
  total: number;
  correct: number;
}

export interface ScoreData {
  questions: Record<string, QuestionStats>;
  sessions: SessionRecord[];
}

export function getScoreData(): ScoreData {
  if (typeof window === "undefined") {
    return { questions: {}, sessions: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // corrupted data
  }
  return { questions: {}, sessions: [] };
}

export function saveScoreData(data: ScoreData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function recordAnswer(questionId: string, isCorrect: boolean): void {
  const data = getScoreData();
  if (!data.questions[questionId]) {
    data.questions[questionId] = { correct: 0, wrong: 0, last: "" };
  }
  if (isCorrect) {
    data.questions[questionId].correct++;
  } else {
    data.questions[questionId].wrong++;
  }
  data.questions[questionId].last = new Date().toISOString();
  saveScoreData(data);

  // Lazy-import to avoid circular dependency
  import("./sync").then((m) => m.markDirty()).catch(() => {});
}

export function recordSession(
  categoryId: number | "mix" | "errors",
  total: number,
  correct: number
): void {
  const data = getScoreData();
  data.sessions.push({
    date: new Date().toISOString(),
    categoryId,
    total,
    correct,
  });
  saveScoreData(data);

  // Push to remote at end of session
  import("./sync")
    .then((m) => {
      m.markDirty();
      m.push();
    })
    .catch(() => {});
}

export function getQuestionStats(
  questionId: string
): QuestionStats | undefined {
  const data = getScoreData();
  return data.questions[questionId];
}

export function getCategoryStats(categoryId: number): {
  totalAnswered: number;
  totalCorrect: number;
  totalWrong: number;
  percentage: number;
} {
  const data = getScoreData();
  let totalAnswered = 0;
  let totalCorrect = 0;
  let totalWrong = 0;

  for (const [qId, stats] of Object.entries(data.questions)) {
    if (qId.startsWith(`${categoryId}-`)) {
      totalAnswered += stats.correct + stats.wrong;
      totalCorrect += stats.correct;
      totalWrong += stats.wrong;
    }
  }

  return {
    totalAnswered,
    totalCorrect,
    totalWrong,
    percentage: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : -1,
  };
}

export function getOverallStats(): {
  totalAnswered: number;
  totalCorrect: number;
  percentage: number;
} {
  const data = getScoreData();
  let totalAnswered = 0;
  let totalCorrect = 0;

  for (const stats of Object.values(data.questions)) {
    totalAnswered += stats.correct + stats.wrong;
    totalCorrect += stats.correct;
  }

  return {
    totalAnswered,
    totalCorrect,
    percentage: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : -1,
  };
}

export function getErrorQuestionIds(categoryId?: number): string[] {
  const data = getScoreData();
  const errors: { id: string; score: number }[] = [];

  for (const [qId, stats] of Object.entries(data.questions)) {
    if (categoryId && !qId.startsWith(`${categoryId}-`)) continue;
    if (stats.wrong > 0) {
      // Priority score: higher = worse performance
      let score = 0;
      if (stats.correct === 0) score = 1000 + stats.wrong;
      else if (stats.wrong > stats.correct) score = 500 + stats.wrong - stats.correct;
      else score = stats.wrong;

      errors.push({ id: qId, score });
    }
  }

  errors.sort((a, b) => b.score - a.score);
  return errors.map((e) => e.id);
}

export function hasErrors(): boolean {
  const data = getScoreData();
  return Object.values(data.questions).some((s) => s.wrong > 0);
}

export function resetAllStats(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
