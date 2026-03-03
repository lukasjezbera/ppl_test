import { NextRequest, NextResponse } from "next/server";

const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

export async function GET() {
  if (!SCRIPT_URL) {
    return NextResponse.json(
      { error: "GOOGLE_SCRIPT_URL not configured" },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(SCRIPT_URL, { redirect: "follow" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Sync fetch failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!SCRIPT_URL) {
    return NextResponse.json(
      { error: "GOOGLE_SCRIPT_URL not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "follow",
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Sync push failed" }, { status: 502 });
  }
}
