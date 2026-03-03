import { Question, getAllQuestions, getQuestionsByCategory, getQuestionById } from "./questions";
import { getErrorQuestionIds, getQuestionStats } from "./scoring";

export function getErrorQuestions(categoryId?: number): Question[] {
  const errorIds = getErrorQuestionIds(categoryId);
  const questions: Question[] = [];

  for (const id of errorIds) {
    const q = getQuestionById(id);
    if (q) questions.push(q);
  }

  return questions;
}

export function getPrioritizedSet(
  categoryId: number | "mix",
  count: number
): Question[] {
  const allQuestions =
    categoryId === "mix" ? getAllQuestions() : getQuestionsByCategory(categoryId);

  // 1. Questions where wrong > 0 and correct == 0 (never answered correctly)
  const neverCorrect: Question[] = [];
  // 2. Questions where wrong > correct
  const moreBad: Question[] = [];
  // 3. Questions where wrong > 0 and correct > 0
  const someWrong: Question[] = [];
  // 4. Unanswered questions
  const unanswered: Question[] = [];
  // 5. All other (answered correctly)
  const rest: Question[] = [];

  for (const q of allQuestions) {
    const stats = getQuestionStats(q.id);
    if (!stats) {
      unanswered.push(q);
    } else if (stats.wrong > 0 && stats.correct === 0) {
      neverCorrect.push(q);
    } else if (stats.wrong > stats.correct) {
      moreBad.push(q);
    } else if (stats.wrong > 0) {
      someWrong.push(q);
    } else {
      rest.push(q);
    }
  }

  // Shuffle each group
  const shuffle = <T>(arr: T[]): T[] => {
    const s = [...arr];
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    return s;
  };

  const prioritized = [
    ...shuffle(neverCorrect),
    ...shuffle(moreBad),
    ...shuffle(someWrong),
    ...shuffle(unanswered),
    ...shuffle(rest),
  ];

  return prioritized.slice(0, count);
}
