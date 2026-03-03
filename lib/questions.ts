import questionsData from "@/data/questions.json";

export interface Question {
  id: string;
  categoryId: number;
  question: string;
  options: string[];
  correctIndex: number;
}

export interface Category {
  id: number;
  name: string;
  questionCount: number;
}

interface QuestionsData {
  categories: Category[];
  questions: Question[];
}

const data = questionsData as QuestionsData;

export function getCategories(): Category[] {
  return data.categories;
}

export function getQuestionsByCategory(categoryId: number): Question[] {
  return data.questions.filter((q) => q.categoryId === categoryId);
}

export function getAllQuestions(): Question[] {
  return data.questions;
}

export function getQuestionById(id: string): Question | undefined {
  return data.questions.find((q) => q.id === id);
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function getShuffledSet(
  categoryId: number | "mix",
  count?: number
): Question[] {
  const questions =
    categoryId === "mix" ? getAllQuestions() : getQuestionsByCategory(categoryId);

  const shuffled = shuffleArray(questions);

  if (count && count < shuffled.length) {
    return shuffled.slice(0, count);
  }

  return shuffled;
}
