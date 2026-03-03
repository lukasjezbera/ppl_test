import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "fs/promises";
import path from "path";

const client = new Anthropic();

const SYSTEM_PROMPT =
  "Jsi zkušený letecký instruktor a pomáháš studentovi s přípravou na zkoušku PPL. Odpovídej česky, stručně a jasně — max 2-3 věty. Vysvětli proč je správná odpověď správná. Pokud student odpověděl špatně, krátce vysvětli proč jeho volba není správná. Mluv jako učitel, který chce aby to student pochopil, ne jako encyklopedie. Pokud je přiložený obrázek, popiš co na něm vidíš v kontextu otázky.";

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, options, correctIndex, selectedIndex, image, history } =
      body as {
        question: string;
        options: string[];
        correctIndex: number;
        selectedIndex: number;
        image?: string;
        history?: HistoryMessage[];
      };

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
        (opt, i) =>
          `${String.fromCharCode(65 + i)}) ${opt}${i === correctIndex ? " ← SPRÁVNÁ ODPOVĚĎ" : ""}${i === selectedIndex && !isCorrect ? " ← ODPOVĚĎ STUDENTA" : ""}`
      )
      .join("\n");

    const contextText = isCorrect
      ? `Otázka: ${question}\n\nMožnosti:\n${optionsText}\n\nStudent odpověděl správně (${String.fromCharCode(65 + correctIndex)}). Vysvětli proč je to správně.`
      : `Otázka: ${question}\n\nMožnosti:\n${optionsText}\n\nStudent zvolil ${String.fromCharCode(65 + selectedIndex)}, ale správná odpověď je ${String.fromCharCode(65 + correctIndex)}. Vysvětli proč je správná odpověď správná a proč studentova volba není správná.`;

    // Load image if available
    let imageBlock: Anthropic.ImageBlockParam | null = null;
    if (image && typeof image === "string") {
      try {
        const imagePath = path.join(
          process.cwd(),
          "public",
          "images",
          path.basename(image)
        );
        const imageBuffer = await readFile(imagePath);
        const base64 = imageBuffer.toString("base64");
        imageBlock = {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: base64 },
        };
      } catch {
        // Image not found — continue without it
      }
    }

    // Build messages array
    const messages: Anthropic.MessageCreateParams["messages"] = [];

    if (history && history.length > 0) {
      // Follow-up: first message includes context + image, then append history
      const firstContent: Anthropic.MessageCreateParams["messages"][0]["content"] =
        [];
      if (imageBlock) firstContent.push(imageBlock);
      firstContent.push({ type: "text", text: contextText });
      messages.push({ role: "user", content: firstContent });

      for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    } else {
      // Initial request
      const content: Anthropic.MessageCreateParams["messages"][0]["content"] =
        [];
      if (imageBlock) content.push(imageBlock);
      content.push({ type: "text", text: contextText });
      messages.push({ role: "user", content });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages,
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
