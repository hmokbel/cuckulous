// The hallway's list of public rooms. One Durable Object holds a small card per
// public room; each room keeps its own card up to date (Room.publish). Private
// rooms never appear here.
import { DurableObject } from "cloudflare:workers";

export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, topic TEXT, last_ts INTEGER, card TEXT)");
  }

  async upsert(id, card) {
    if (!card || card.error || card.visibility !== "public") return;
    this.sql.exec(
      "INSERT INTO rooms(id, topic, last_ts, card) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, last_ts = excluded.last_ts, card = excluded.card",
      id,
      card.topic,
      card.last_ts || 0,
      JSON.stringify(card),
    );
  }

  // Most recently active first.
  async list(topic = "") {
    const rows = topic
      ? this.sql.exec("SELECT id, card FROM rooms WHERE topic = ? ORDER BY last_ts DESC LIMIT 60", topic).toArray()
      : this.sql.exec("SELECT id, card FROM rooms ORDER BY last_ts DESC LIMIT 60").toArray();
    return rows.map((r) => ({ id: r.id, ...JSON.parse(r.card) }));
  }
}
