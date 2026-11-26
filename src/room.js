// One Durable Object per room. Everything that happens is an event row, so the
// watch page and the history are built from the same log.
import { DurableObject } from "cloudflare:workers";
import { findSecret } from "./scan.js";
import { chainHash } from "./chain.js";

export const LIMITS = {
  title: 200,
  brief: 8000,
  name: 40,
  body: 8000,
  writesPerMinute: 30,
  events: 5000,
  members: 20,
};
export const POST_KINDS = ["attempt", "result", "question", "note"];

const err = (error) => ({ error });

// The AI model a member's agent says it is ("Claude Opus 5.5", "GPT-5"), or the
// app that connected. Short, plain text only; anything else is dropped.
export const cleanLabel = (v) => {
  const t = String(v ?? "").replace(/[^\w .:()\/+-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return t || null;
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.writes = new Map(); // member id -> recent write timestamps
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, key_hash TEXT UNIQUE, role TEXT, created_at INTEGER, removed_at INTEGER, app TEXT, model TEXT)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS steps(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, detail TEXT, created_by INTEGER, created_at INTEGER, status TEXT, claimed_by INTEGER, merged_event INTEGER)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, member_id INTEGER, type TEXT, step_id INTEGER, kind TEXT, body TEXT, model TEXT, prev_hash TEXT, hash TEXT)",
    );
    // Rooms created before these columns existed get them, plus a hash backfill.
    for (const [table, col] of [["events", "model"], ["events", "prev_hash"], ["events", "hash"], ["members", "app"], ["members", "model"]]) {
      try {
        this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
      } catch {
        // column already there
      }
    }
    if (this.sql.exec("SELECT COUNT(*) AS n FROM events WHERE hash IS NULL").one().n) this.rechain();
  }

  // Recomputes every hash in order. Only used to backfill older rooms.
  rechain() {
    let prev = this.meta("brief_hash") || "";
    for (const e of this.sql.exec("SELECT * FROM events ORDER BY id").toArray()) {
      const hash = chainHash(e, prev);
      this.sql.exec("UPDATE events SET prev_hash = ?, hash = ? WHERE id = ?", prev, hash, e.id);
      prev = hash;
    }
  }

  // ---- helpers ----
  meta(k) {
    const row = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return row ? row.v : null;
  }
  exists() {
    return this.meta("title") !== null;
  }
  member(keyHash) {
    return (
      this.sql
        .exec("SELECT * FROM members WHERE key_hash = ? AND removed_at IS NULL", keyHash)
        .toArray()[0] || null
    );
  }
  step(id) {
    return this.sql.exec("SELECT * FROM steps WHERE id = ?", id).toArray()[0] || null;
  }
  // Appends to the log. Synchronous on purpose: reading the last hash and
  // writing the next one happen with no await in between (see chain.js).
  event(memberId, type, stepId = null, kind = null, body = null, model = null) {
    const last = this.sql.exec("SELECT hash FROM events ORDER BY id DESC LIMIT 1").toArray()[0];
    const prev = last ? last.hash : this.meta("brief_hash") || "";
    const ts = Date.now();
    this.sql.exec(
      "INSERT INTO events(ts, member_id, type, step_id, kind, body, model, prev_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ts,
      memberId,
      type,
      stepId,
      kind,
      body,
      model,
      prev,
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    const hash = chainHash({ id, ts, member_id: memberId, type, step_id: stepId, kind, body, model }, prev);
    this.sql.exec("UPDATE events SET hash = ? WHERE id = ?", hash, id);
    return id;
  }
  // Checks membership, rate limit and room size for any write.
  writer(keyHash) {
    if (!this.exists()) return err("This room does not exist.");
    const m = this.member(keyHash);
    if (!m) return err("This key is not a member of the room, or it was removed.");
    const now = Date.now();
    const recent = (this.writes.get(m.id) || []).filter((t) => now - t < 60_000);
    if (recent.length >= LIMITS.writesPerMinute)
      return err(`Slow down: at most ${LIMITS.writesPerMinute} writes per minute.`);
    const count = this.sql.exec("SELECT COUNT(*) AS n FROM events").one().n;
    if (count >= LIMITS.events) return err("This room is full. Start a new room to continue.");
    recent.push(now);
    this.writes.set(m.id, recent);
    return { member: m };
  }

  // Remembers the latest model a member's agent reported, and the app it
  // connected with. Shown next to the member's name; not part of the work.
  noteModel(keyHash, model) {
    const m = this.member(keyHash);
    const label = cleanLabel(model);
    if (m && label && label !== m.model) this.sql.exec("UPDATE members SET model = ? WHERE id = ?", label, m.id);
    return label;
  }
  noteApp(keyHash, app) {
    const m = this.member(keyHash);
    const label = cleanLabel(app);
    if (m && label && label !== m.app) this.sql.exec("UPDATE members SET app = ? WHERE id = ?", label, m.id);
  }

  // ---- room lifecycle ----
  async create({ title, brief, briefHash, ownerName, ownerKeyHash }) {
    if (this.exists()) return err("Room already exists.");
    const now = Date.now();
    for (const [k, v] of [
      ["title", title],
      ["brief", brief],
      ["brief_hash", briefHash],
      ["created_at", String(now)],
    ])
      this.sql.exec("INSERT INTO meta(k, v) VALUES (?, ?)", k, v);
    this.sql.exec(
      "INSERT INTO members(name, key_hash, role, created_at) VALUES (?, ?, 'owner', ?)",
      ownerName,
      ownerKeyHash,
      now,
    );
    const ownerId = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.event(ownerId, "created", null, null, title);
    return { ok: true };
  }

  async whoami(keyHash) {
    if (!this.exists()) return err("This room does not exist.");
    const m = this.member(keyHash);
    if (!m) return err("This key is not a member of the room, or it was removed.");
    return { id: m.id, name: m.name, role: m.role };
  }

  async invite(ownerKeyHash, name, memberKeyHash) {
    const w = this.writer(ownerKeyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the room owner can invite people.");
    const active = this.sql
      .exec("SELECT COUNT(*) AS n FROM members WHERE removed_at IS NULL")
      .one().n;
    if (active >= LIMITS.members) return err(`A room holds at most ${LIMITS.members} members.`);
    this.sql.exec(
      "INSERT INTO members(name, key_hash, role, created_at) VALUES (?, ?, 'member', ?)",
      name,
      memberKeyHash,
      Date.now(),
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.event(w.member.id, "invited", null, null, String(id));
    return { ok: true, id };
  }

  async remove(ownerKeyHash, memberId) {
    const w = this.writer(ownerKeyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the room owner can remove people.");
    const target = this.sql.exec("SELECT * FROM members WHERE id = ?", memberId).toArray()[0];
    if (!target || target.removed_at) return err("No such member.");
    if (target.role === "owner") return err("The owner can't be removed.");
    this.sql.exec("UPDATE members SET removed_at = ? WHERE id = ?", Date.now(), memberId);
    this.sql.exec(
      "UPDATE steps SET status = 'open', claimed_by = NULL WHERE claimed_by = ? AND status = 'claimed'",
      memberId,
    );
    this.event(w.member.id, "removed", null, null, String(memberId));
    return { ok: true };
  }

  // ---- the work ----
  async addStep(keyHash, title, detail, model) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    title = String(title || "").trim();
    detail = String(detail || "").trim();
    if (!title) return err("A step needs a title.");
    if (title.length > LIMITS.title) return err(`Titles are at most ${LIMITS.title} characters.`);
    if (detail.length > LIMITS.body) return err(`Details are at most ${LIMITS.body} characters.`);
    const secret = findSecret(title + "\n" + detail);
    if (secret) return err(`Blocked: this looks like it contains ${secret}. Nothing was saved.`);
    this.sql.exec(
      "INSERT INTO steps(title, detail, created_by, created_at, status) VALUES (?, ?, ?, ?, 'open')",
      title,
      detail,
      w.member.id,
      Date.now(),
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.event(w.member.id, "step_added", id, null, title, this.noteModel(keyHash, model));
    return { ok: true, step_id: id };
  }

  async claim(keyHash, stepId, model) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    const s = this.step(stepId);
    if (!s) return err("No such step.");
    if (s.status === "done") return err("That step is already merged.");
    if (s.status === "claimed" && s.claimed_by !== w.member.id)
      return err("Someone else has claimed that step. Pick another, or post a note on it.");
    this.sql.exec(
      "UPDATE steps SET status = 'claimed', claimed_by = ? WHERE id = ?",
      w.member.id,
      stepId,
    );
    this.event(w.member.id, "claimed", stepId, null, null, this.noteModel(keyHash, model));
    return { ok: true };
  }

  async post(keyHash, stepId, kind, body, model) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    if (!POST_KINDS.includes(kind)) return err(`kind must be one of: ${POST_KINDS.join(", ")}.`);
    body = String(body || "").trim();
    if (!body) return err("Empty post.");
    if (body.length > LIMITS.body) return err(`Posts are at most ${LIMITS.body} characters.`);
    if (stepId != null && !this.step(stepId)) return err("No such step.");
    const secret = findSecret(body);
    if (secret) return err(`Blocked: this looks like it contains ${secret}. Nothing was saved.`);
    const id = this.event(w.member.id, "post", stepId ?? null, kind, body, this.noteModel(keyHash, model));
    return { ok: true, post_id: id };
  }

  async merge(keyHash, stepId, postId, model) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the room owner can merge a step.");
    const s = this.step(stepId);
    if (!s) return err("No such step.");
    if (s.status === "done") return err("That step is already merged.");
    const p = this.sql
      .exec("SELECT * FROM events WHERE id = ? AND type = 'post'", postId)
      .toArray()[0];
    if (!p || p.step_id !== stepId) return err("That post doesn't belong to this step.");
    this.sql.exec(
      "UPDATE steps SET status = 'done', merged_event = ? WHERE id = ?",
      postId,
      stepId,
    );
    this.event(w.member.id, "merged", stepId, null, String(postId), this.noteModel(keyHash, model));
    return { ok: true };
  }

  // ---- reading ----
  // The whole history, for download and independent verification.
  async log() {
    if (!this.exists()) return err("This room does not exist.");
    return {
      room: {
        title: this.meta("title"),
        brief: this.meta("brief"),
        brief_hash: this.meta("brief_hash"),
        created_at: Number(this.meta("created_at")),
        members: this.sql
          .exec("SELECT id, name, role, removed_at, app, model FROM members ORDER BY id")
          .toArray()
          .map((m) => ({ id: m.id, name: m.name, role: m.role, removed: !!m.removed_at, app: m.app, model: m.model })),
      },
      events: this.sql
        .exec("SELECT id, ts, member_id, type, step_id, kind, body, model, prev_hash, hash FROM events ORDER BY id")
        .toArray(),
    };
  }

  async state(since = 0, tail = 0) {
    if (!this.exists()) return err("This room does not exist.");
    const members = this.sql
      .exec("SELECT id, name, role, removed_at, app, model FROM members ORDER BY id")
      .toArray()
      .map((m) => ({ id: m.id, name: m.name, role: m.role, removed: !!m.removed_at, app: m.app, model: m.model }));
    const steps = this.sql.exec("SELECT * FROM steps ORDER BY id").toArray();
    const events = tail
      ? this.sql
          .exec("SELECT * FROM (SELECT * FROM events ORDER BY id DESC LIMIT ?) ORDER BY id", tail)
          .toArray()
      : this.sql
          .exec("SELECT * FROM events WHERE id > ? ORDER BY id LIMIT 500", Number(since) || 0)
          .toArray();
    const last = this.sql.exec("SELECT COALESCE(MAX(id), 0) AS id FROM events").one().id;
    return {
      title: this.meta("title"),
      brief: this.meta("brief"),
      brief_hash: this.meta("brief_hash"),
      created_at: Number(this.meta("created_at")),
      members,
      steps,
      events,
      last_event_id: last,
    };
  }
}
