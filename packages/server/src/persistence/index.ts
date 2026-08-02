import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface MatchResultRecord {
  seed: number;
  result: string;
  durationTicks: number;
  players: {
    name: string;
    charId: string;
    exp: number;
    kills: number;
    deaths: number;
  }[];
}

export interface Persistence {
  saveMatchResult(record: MatchResultRecord): Promise<void>;
}

/** Local JSONL persistence — swap for Supabase later without touching game code. */
class LocalJsonPersistence implements Persistence {
  private file = join(process.cwd(), "data", "match-results.jsonl");

  async saveMatchResult(record: MatchResultRecord): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(
      this.file,
      JSON.stringify({ ...record, at: new Date().toISOString() }) + "\n",
      "utf8",
    );
  }
}

export const persistence: Persistence = new LocalJsonPersistence();
