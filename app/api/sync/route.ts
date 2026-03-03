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
    const bodyStr = JSON.stringify(body);

    // Google Apps Script returns a 302 redirect.
    // fetch() changes POST→GET on 302, so we must follow manually.
    let res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyStr,
      redirect: "manual",
    });

    // Follow redirect(s) preserving POST method
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location) {
        res = await fetch(location, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: bodyStr,
          redirect: "follow",
        });
      }
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Sync push failed" }, { status: 502 });
  }
}
