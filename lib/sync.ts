import { getScoreData, saveScoreData, type ScoreData } from "./scoring";

let dirty = false;
let syncing = false;

export function markDirty(): void {
  dirty = true;
}

export function isDirty(): boolean {
  return dirty;
}

/** Pull data from Google Sheet and merge into localStorage */
export async function pull(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const res = await fetch("/api/sync");
    if (!res.ok) return;
    const remote: ScoreData = await res.json();
    if (!remote.questions && !remote.sessions) return;
    const local = getScoreData();
    const merged = merge(local, remote);
    saveScoreData(merged);
  } catch {
    // offline or error — silently ignore, localStorage stays as-is
  } finally {
    syncing = false;
  }
}

/** Push localStorage data to Google Sheet */
export async function push(): Promise<void> {
  if (syncing || !dirty) return;
  syncing = true;
  try {
    const data = getScoreData();
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      dirty = false;
    }
  } catch {
    // offline — will retry on next push
  } finally {
    syncing = false;
  }
}

/** Merge local and remote data — takes the "richer" version for each entry */
export function merge(local: ScoreData, remote: ScoreData): ScoreData {
  const questions: ScoreData["questions"] = { ...remote.questions };

  // Merge questions: keep the one with more total attempts
  for (const [qId, localStats] of Object.entries(local.questions)) {
    const remoteStats = questions[qId];
    if (!remoteStats) {
      questions[qId] = localStats;
    } else {
      const localTotal = localStats.correct + localStats.wrong;
      const remoteTotal = remoteStats.correct + remoteStats.wrong;
      if (localTotal > remoteTotal) {
        questions[qId] = localStats;
      } else if (localTotal === remoteTotal) {
        // Same total — keep whichever was updated more recently
        questions[qId] =
          localStats.last > remoteStats.last ? localStats : remoteStats;
      }
      // else remote has more data, already in questions
    }
  }

  // Merge sessions: keep the longer list
  const sessions =
    local.sessions.length >= remote.sessions.length
      ? local.sessions
      : remote.sessions;

  return { questions, sessions };
}
