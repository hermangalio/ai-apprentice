import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Frame, Question, Scorecard, ScreenEvent, Session, TranscriptItem, WorkMap } from "./types";

// Server-only file store: data/sessions/<id>/{session,events,transcript,
// questions,frames,workmap,scorecard}.json plus frames/<frameId>.jpg.
// Sessions under fixtures/sessions/ are readable through the same functions.

const DATA = path.join(process.cwd(), "data", "sessions");
const FIXTURES = path.join(process.cwd(), "fixtures", "sessions");

export const newId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

async function exists(p: string) {
  return fs.access(p).then(() => true, () => false);
}

export async function sessionDir(id: string) {
  const fixture = path.join(FIXTURES, id);
  return (await exists(fixture)) ? fixture : path.join(DATA, id);
}

async function readJSON<T>(id: string, name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(await sessionDir(id), name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Writes are serialized per file so concurrent appends do not lose items.
const locks = new Map<string, Promise<unknown>>();

async function writeJSON(id: string, name: string, update: (current: unknown) => unknown) {
  const file = path.join(await sessionDir(id), name);
  const run = (locks.get(file) ?? Promise.resolve()).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const current = await fs.readFile(file, "utf8").then(JSON.parse, () => undefined);
    await fs.writeFile(file, JSON.stringify(update(current), null, 2));
  });
  locks.set(file, run.catch(() => {}));
  return run;
}

function list<T extends { id: string }>(name: string) {
  return {
    all: (sessionId: string) => readJSON<T[]>(sessionId, name, []),
    append: (sessionId: string, ...items: T[]) =>
      writeJSON(sessionId, name, (cur) => [...((cur as T[]) ?? []), ...items]),
    // Insert or replace by id.
    upsert: (sessionId: string, item: T) =>
      writeJSON(sessionId, name, (cur) => {
        const items = (cur as T[]) ?? [];
        const i = items.findIndex((x) => x.id === item.id);
        return i < 0 ? [...items, item] : items.map((x, j) => (j === i ? item : x));
      }),
    replaceAll: (sessionId: string, items: T[]) => writeJSON(sessionId, name, () => items),
    // Read, change and write under the file lock, so appends made at the same
    // time are not lost.
    update: (sessionId: string, change: (items: T[]) => T[]) =>
      writeJSON(sessionId, name, (cur) => change((cur as T[]) ?? [])),
  };
}

function doc<T>(name: string) {
  return {
    get: (sessionId: string) => readJSON<T | null>(sessionId, name, null),
    set: (sessionId: string, value: T) => writeJSON(sessionId, name, () => value),
  };
}

export const sessions = {
  ...doc<Session>("session.json"),
  async create(input: Omit<Session, "id" | "startedAt">): Promise<Session> {
    const session: Session = { ...input, id: newId("ses"), startedAt: new Date().toISOString() };
    await writeJSON(session.id, "session.json", () => session);
    return session;
  },
  async list(): Promise<Session[]> {
    const out: Session[] = [];
    for (const root of [FIXTURES, DATA]) {
      for (const id of await fs.readdir(root).catch(() => [] as string[])) {
        const s = await readJSON<Session | null>(id, "session.json", null);
        if (s) out.push(s);
      }
    }
    return out;
  },
};

export const events = list<ScreenEvent>("events.json");
export const transcript = list<TranscriptItem>("transcript.json");
export const questions = list<Question>("questions.json");
export const frames = list<Frame>("frames.json");
export const workMaps = doc<WorkMap>("workmap.json");
export const scorecards = doc<Scorecard>("scorecard.json");

export async function saveFrameImage(sessionId: string, frameId: string, jpeg: Buffer) {
  const file = path.join(await sessionDir(sessionId), "frames", `${frameId}.jpg`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, jpeg);
  return `frames/${frameId}.jpg`;
}

export async function readFrameImage(sessionId: string, frameId: string) {
  return fs.readFile(path.join(await sessionDir(sessionId), "frames", `${frameId}.jpg`));
}

export type PurgeCounts = { frames: number; events: number; transcript: number; questions: number };

// Off the record: drop everything captured in [fromT, toT] from every stream.
// Questions are derived from events, so a question goes too when it is about
// a purged event or was asked inside the window. Returns what was removed.
export async function purgeWindow(sessionId: string, fromT: number, toT: number): Promise<PurgeCounts> {
  const inWindow = (x: { t: number }) => x.t >= fromT && x.t <= toT;
  const counts: PurgeCounts = { frames: 0, events: 0, transcript: 0, questions: 0 };
  const dir = await sessionDir(sessionId);

  const droppedFrames: Frame[] = [];
  await frames.update(sessionId, (all) => all.filter((f) => (inWindow(f) ? (droppedFrames.push(f), false) : true)));
  await Promise.all(droppedFrames.map((f) => fs.rm(path.join(dir, f.file), { force: true })));
  counts.frames = droppedFrames.length;

  const eventIds = new Set<string>();
  await events.update(sessionId, (all) => all.filter((e) => (inWindow(e) ? (eventIds.add(e.id), false) : true)));
  counts.events = eventIds.size;

  const transcriptIds = new Set<string>();
  await transcript.update(sessionId, (all) => all.filter((x) => (inWindow(x) ? (transcriptIds.add(x.id), false) : true)));
  counts.transcript = transcriptIds.size;

  await questions.update(sessionId, (all) => {
    const kept: Question[] = [];
    for (const q of all) {
      const aboutPurged = q.eventIds.some((id) => eventIds.has(id));
      const askedInWindow = q.askedAt !== undefined && q.askedAt >= fromT && q.askedAt <= toT;
      if (aboutPurged || askedInWindow) {
        counts.questions++;
        continue;
      }
      // The question stays but an answer given inside the window is gone.
      const answers = q.answerTranscriptIds?.filter((id) => !transcriptIds.has(id));
      if (answers && answers.length !== q.answerTranscriptIds!.length) {
        kept.push({ ...q, answerTranscriptIds: answers, status: q.status === "answered" && answers.length === 0 ? "asked" : q.status });
      } else {
        kept.push(q);
      }
    }
    return kept;
  });
  return counts;
}
