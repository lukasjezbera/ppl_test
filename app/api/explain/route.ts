import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, options, correctIndex, selectedIndex } = body;

    if (
      !question ||
      !Array.isArray(options) ||
      correctIndex === undefined ||
      selectedIndex === undefined
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const isCorrect = selectedIndex === correctIndex;

    const optionsText = options
      .map(
        (opt: string, i: number) =>
          `${String.fromCharCode(65 + i)}) ${opt}${i === correctIndex ? " ← SPRÁVNÁ ODPOVĚĎ" : ""}${i === selectedIndex && !isCorrect ? " ← ODPOVĚĎ STUDENTA" : ""}`
      )
      .join("\n");

    const userMessage = isCorrect
      ? `Otázka: ${question}\n\nMožnosti:\n${optionsText}\n\nStudent odpověděl správně (${String.fromCharCode(65 + correctIndex)}). Vysvětli proč je to správně.`
      : `Otázka: ${question}\n\nMožnosti:\n${optionsText}\n\nStudent zvolil ${String.fromCharCode(65 + selectedIndex)}, ale správná odpověď je ${String.fromCharCode(65 + correctIndex)}. Vysvětli proč je správná odpověď správná a proč studentova volba není správná.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 300,
      system:
        "Jsi zkušený letecký instruktor a pomáháš studentovi s přípravou na zkoušku PPL. Odpovídej česky, stručně a jasně — max 2-3 věty. Vysvětli proč je správná odpověď správná. Pokud student odpověděl špatně, krátce vysvětli proč jeho volba není správná. Mluv jako učitel, který chce aby to student pochopil, ne jako encyklopedie.",
      messages: [{ role: "user", content: userMessage }],
    });

    const explanation =
      message.content[0].type === "text" ? message.content[0].text : "";

    return NextResponse.json({ explanation });
  } catch (error) {
    console.error("Explain API error:", error);
    return NextResponse.json(
      { error: "Nepodařilo se získat vysvětlení. Zkuste to znovu." },
      { status: 500 }
    );
  }
}
