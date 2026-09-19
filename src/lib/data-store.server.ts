import { db } from "@/db/client";
import { ensureSchema } from "@/db/schema";
import type { Database } from "./data-store.types";
import { rpc } from "./db.rpc.server";

type Tables = Database["public"]["Tables"];
type TableName = keyof Tables & string;
type RowOf<T extends TableName> = Tables[T]["Row"];

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface PostgrestLikeError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Columns stored as TEXT that every caller treats as JSON objects/arrays.
 * Written via JSON.stringify, read back via JSON.parse.
 */
const JSON_COLUMNS: Record<string, true> = {
  category_scores: true,
  stack_detected: true,
  checklist: true,
  file_hashes: true,
  dependency_graph: true,
  checked_for: true,
  detection: true,
  payload: true,
  results: true,
  structured_results: true,
  agent_reasoning: true,
  generated_file_hashes: true,
  pending_files: true,
  pending_ai_files: true,
  planned_steps: true,
  completed_steps: true,
  ai_files: true,
  findings: true,
};

/**
 * SQLite has no booleans. Callers pass and expect real booleans, so convert both ways.
 */
const BOOLEAN_COLUMNS: Record<string, true> = {
  private: true,
  revoked: true,
  enabled: true,
  published: true,
  is_secret: true,
  include_test: true,
  auto_fixable: true,
};

type Row = Record<string, unknown>;

function encodeValue(key: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (value !== null && typeof value === "object") {
    if (JSON_COLUMNS[key] || !(value instanceof Date)) return JSON.stringify(value);
    return value.toISOString();
  }
  if (BOOLEAN_COLUMNS[key] && typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function decodeRow(row: Row): Row {
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (JSON_COLUMNS[key] && typeof value === "string") {
      // Only parse when it looks like JSON — some rows may hold raw text.
      const first = value[0];
      if (first === "{" || first === "[") {
        try {
          row[key] = JSON.parse(value);
        } catch {
          /* leave as string */
        }
      }
    } else if (BOOLEAN_COLUMNS[key] && typeof value === "number") {
      row[key] = value !== 0;
    }
  }
  return row;
}

function encodeRow(data: Row): Row {
  const out: Row = {};
  for (const key of Object.keys(data)) {
    if (data[key] === undefined) continue; // PostgREST omits undefined fields
    out[key] = encodeValue(key, data[key]);
  }
  return out;
}

interface Filters {
  column: string;
  op: string;
  value: unknown;
}

type QueryResult<T> = { data: T; error: PostgrestLikeError | null; count?: number };

class QueryBuilder<TData = Row, TResult = TData[]> {
  private filters: Filters[] = [];
  private selectedFields = "*";
  private orderBy: { column: string; ascending: boolean }[] = [];
  private limitCount: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private isSingle = false;
  private isMaybeSingle = false;
  private headCount = false;

  private _insertData: Row | Row[] | null = null;
  private _updateData: Row | null = null;
  private _upsertData: Row | null = null;
  private _upsertOnConflict: string | null = null;
  private _ignoreDuplicates = false;
  private _delete = false;

  constructor(private table: string) {}

  select(fields = "*", options?: { count?: string; head?: boolean }): QueryBuilder<TData, TData[]> {
    this.selectedFields = fields;
    if (options?.head) this.headCount = true;
    return this as unknown as QueryBuilder<TData, TData[]>;
  }

  insert(data: Row | Row[]): QueryBuilder<TData, TData[]> {
    this._insertData = data;
    return this as unknown as QueryBuilder<TData, TData[]>;
  }

  update(data: Row): QueryBuilder<TData, TData[]> {
    this._updateData = data;
    return this as unknown as QueryBuilder<TData, TData[]>;
  }

  upsert(
    data: Row | Row[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): QueryBuilder<TData, TData[]> {
    this._upsertData = data as Row;
    this._upsertOnConflict = options?.onConflict ?? null;
    this._ignoreDuplicates = options?.ignoreDuplicates ?? false;
    return this as unknown as QueryBuilder<TData, TData[]>;
  }

  delete(): QueryBuilder<TData, TData[]> {
    this._delete = true;
    return this as unknown as QueryBuilder<TData, TData[]>;
  }

  eq(column: string, value: unknown): QueryBuilder<TData, TResult> {
    this.filters.push({ column, op: "=", value });
    return this;
  }
  neq(column: string, value: unknown): QueryBuilder<TData, TResult> {
    this.filters.push({ column, op: "!=", value });
    return this;
  }
  lt(column: string, value: unknown): QueryBuilder<TData, TResult> {
    this.filters.push({ column, op: "<", value });
    return this;
  }
  lte(column: string, value: unknown): QueryBuilder<TData, TResult> {
    this.filters.push({ column, op: "<=", value });
    return this;
  }
  gt(column: string, value: unknown): QueryBuilder<TData, TResult> {
    this.filters.push({ column, op: ">", value });
    return this;
  }
  gte(column: string, value: unknown): QueryBuilder<TData, TResult> {
    this.filters.push({ column, op: ">=", value });
    return this;
  }
  like(column: string, value: string): QueryBuilder<TData, TResult> {
    this.filters.push({ column, op: "LIKE", value });
    return this;
  }
  is(column: string, value: unknown): QueryBuilder<TData, TResult> {
    if (value === null) this.filters.push({ column, op: "IS", value });
    else this.filters.push({ column, op: "=", value });
    return this;
  }
  in(column: string, values: unknown[]): QueryBuilder<TData, TResult> {
    this.filters.push({ column, op: "IN", value: values });
    return this;
  }
  not(column: string, op: string, value: unknown): QueryBuilder<TData, TResult> {
    if (op === "is" && value === null) this.filters.push({ column, op: "IS NOT", value });
    else this.filters.push({ column, op: `NOT ${op.toUpperCase()}`, value });
    return this;
  }
  or(expr: string): QueryBuilder<TData, TResult> {
    this.filters.push({ column: "__or__", op: "raw", value: expr });
    return this;
  }

  order(
    column: string,
    opts?: { ascending?: boolean; nullsFirst?: boolean },
  ): QueryBuilder<TData, TResult> {
    this.orderBy.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }
  limit(count: number): QueryBuilder<TData, TResult> {
    this.limitCount = count;
    return this;
  }
  range(from: number, to: number): QueryBuilder<TData, TResult> {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single(): QueryBuilder<TData, TData> {
    this.isSingle = true;
    return this as unknown as QueryBuilder<TData, TData>;
  }
  maybeSingle(): QueryBuilder<TData, TData | null> {
    this.isMaybeSingle = true;
    return this as unknown as QueryBuilder<TData, TData | null>;
  }
  returns<TNew>(): QueryBuilder<TData, TNew> {
    return this as unknown as QueryBuilder<TData, TNew>;
  }
  csv(): QueryBuilder<TData, TResult> {
    return this;
  }
  textSearch(): QueryBuilder<TData, TResult> {
    return this;
  }

  private buildWhere(): { sql: string; params: unknown[] } {
    if (this.filters.length === 0) return { sql: "", params: [] };
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const f of this.filters) {
      if (f.column === "__or__") {
        // e.g. "status.eq.failed,status.eq.pending" → (status = ? OR status = ?)
        const parts = String(f.value)
          .split(",")
          .map((p) => p.trim());
        const sub: string[] = [];
        for (const p of parts) {
          const m = p.match(/^(\w+)\.(eq|neq|lt|gt|lte|gte|is|ilike|like)\.(.*)$/);
          if (m) {
            const [, col, op, raw] = m;
            if (op === "ilike" || op === "like") {
              // PostgREST embeds the pattern with % wildcards: col.ilike.%term%
              const pattern = raw.replace(/^%|%$/g, "");
              sub.push(`${col} LIKE ?`);
              params.push(`%${pattern}%`);
              continue;
            }
            const val = raw === "null" ? null : decodeScalar(raw);
            sub.push(`${col} ${sqlOp(op)} ?`);
            params.push(val === null ? null : encodeValue(col, val));
          } else {
            sub.push(p); // raw SQL passthrough
          }
        }
        clauses.push(`(${sub.join(" OR ")})`);
        continue;
      }
      if (f.op === "IS") {
        clauses.push(`${f.column} IS NULL`);
        continue;
      }
      if (f.op === "IS NOT") {
        clauses.push(`${f.column} IS NOT NULL`);
        continue;
      }
      if (f.op === "IN") {
        const vals = Array.isArray(f.value) ? f.value : [f.value];
        clauses.push(`${f.column} IN (${vals.map(() => "?").join(",")})`);
        params.push(...vals.map((v) => encodeValue(f.column, v)));
        continue;
      }
      clauses.push(`${f.column} ${f.op} ?`);
      params.push(encodeValue(f.column, f.value));
    }
    return { sql: `WHERE ${clauses.join(" AND ")}`, params };
  }

  private buildColumns(): string {
    if (this.selectedFields.trim() === "*") return "*";
    return this.selectedFields;
  }

  private finalize(result: { rows: Row[]; count?: number }): QueryResult<TData | TData[] | null> {
    const rows = result.rows.map(decodeRow);
    if (this.headCount) {
      return { data: [] as unknown as TData, error: null, count: result.count ?? 0 };
    }
    if (this.isSingle || this.isMaybeSingle) {
      if (rows.length > 1 && this.isSingle) {
        return { data: null, error: { message: `More than one row returned`, code: "PGRST116" } };
      }
      const one = rows[0] ?? null;
      if (!one && this.isSingle) {
        return { data: null, error: { message: "No rows returned", code: "PGRST116" } };
      }
      return { data: one as unknown as TData, error: null };
    }
    return { data: rows as unknown as TData, error: null };
  }

  private thenAll(): QueryResult<TData | TData[] | null> {
    if (this._delete) return this.runDelete();
    if (this._upsertData) return this.runUpsert();
    if (this._insertData) return this.runInsert();
    if (this._updateData) return this.runUpdate();
    return this.runSelect();
  }

  private runSelect(): QueryResult<TData | TData[] | null> {
    const where = this.buildWhere();
    let orderSql = "";
    if (this.orderBy.length > 0) {
      orderSql =
        " ORDER BY " +
        this.orderBy.map((o) => `${o.column} ${o.ascending ? "ASC" : "DESC"}`).join(", ");
    }
    let limitSql = "";
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      limitSql = ` LIMIT ${this.rangeTo - this.rangeFrom + 1} OFFSET ${this.rangeFrom}`;
    } else if (this.limitCount !== null) {
      limitSql = ` LIMIT ${this.limitCount}`;
    }

    try {
      if (this.headCount) {
        const row = db
          .prepare(`SELECT COUNT(*) AS count FROM ${this.table} ${where.sql}`)
          .get(...where.params) as { count: number };
        return { data: [] as unknown as TData, error: null, count: row.count };
      }
      const rows = db
        .prepare(
          `SELECT ${this.buildColumns()} FROM ${this.table} ${where.sql}${orderSql}${limitSql}`,
        )
        .all(...where.params) as Row[];
      return this.finalize({ rows });
    } catch (e) {
      return { data: null, error: errOf(e) };
    }
  }

  private runInsert(): QueryResult<TData | TData[] | null> {
    const input = this._insertData;
    if (!input || (Array.isArray(input) && input.length === 0)) {
      return { data: null, error: { message: "No data to insert" } };
    }
    const rows = (Array.isArray(input) ? input : [input]).map(encodeRow);
    try {
      const out: Row[] = [];
      const insertAll = db.transaction(() => {
        for (const row of rows) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          const sql = `INSERT INTO ${this.table} (${keys.join(", ")}) VALUES (${keys
            .map(() => "?")
            .join(", ")})`;
          const info = db.prepare(sql).run(...keys.map((k) => row[k]));
          const saved = db
            .prepare(`SELECT * FROM ${this.table} WHERE rowid = ?`)
            .get(info.lastInsertRowid) as Row;
          out.push(saved);
        }
      });
      insertAll();
      return this.finalize({ rows: out });
    } catch (e) {
      return { data: null, error: errOf(e) };
    }
  }

  private runUpsert(): QueryResult<TData | TData[] | null> {
    const input = this._upsertData;
    if (!input) return { data: null, error: { message: "No data to upsert" } };
    const rows = (Array.isArray(input) ? input : [input]).map(encodeRow);
    try {
      const out: Row[] = [];
      const upsertAll = db.transaction(() => {
        for (const row of rows) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          const conflict = this._upsertOnConflict
            ? this._upsertOnConflict
            : this.table === "site_config"
              ? "key"
              : primaryKeys(this.table)[0];
          const updateKeys = keys.filter((k) => k !== conflict);
          let sql: string;
          if (this._ignoreDuplicates || updateKeys.length === 0) {
            sql = `INSERT OR IGNORE INTO ${this.table} (${keys.join(", ")}) VALUES (${keys
              .map(() => "?")
              .join(", ")})`;
          } else {
            sql = `INSERT INTO ${this.table} (${keys.join(", ")}) VALUES (${keys
              .map(() => "?")
              .join(", ")})
              ON CONFLICT(${conflict}) DO UPDATE SET ${updateKeys
                .map((k) => `${k} = excluded.${k}`)
                .join(", ")}`;
          }
          const info = db.prepare(sql).run(...keys.map((k) => row[k]));
          const idCol = primaryKeys(this.table)[0] ?? "id";
          const saved =
            info.changes > 0
              ? (db
                  .prepare(`SELECT * FROM ${this.table} WHERE ${idCol} = ?`)
                  .get(row[idCol]) as Row)
              : null;
          if (saved) out.push(saved);
        }
      });
      upsertAll();
      return this.finalize({ rows: out });
    } catch (e) {
      return { data: null, error: errOf(e) };
    }
  }

  private runUpdate(): QueryResult<TData | TData[] | null> {
    const data = encodeRow(this._updateData ?? {});
    const keys = Object.keys(data);
    if (keys.length === 0) return { data: null, error: null };
    const where = this.buildWhere();
    try {
      db.prepare(
        `UPDATE ${this.table} SET ${keys.map((k) => `${k} = ?`).join(", ")} ${where.sql}`,
      ).run(...keys.map((k) => data[k]), ...where.params);
      return { data: null, error: null };
    } catch (e) {
      return { data: null, error: errOf(e) };
    }
  }

  private runDelete(): QueryResult<TData | TData[] | null> {
    const where = this.buildWhere();
    try {
      db.prepare(`DELETE FROM ${this.table} ${where.sql}`).run(...where.params);
      return { data: null, error: null };
    } catch (e) {
      return { data: null, error: errOf(e) };
    }
  }

  then<TResult1 = QueryResult<TResult>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<TResult>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.thenAll() as unknown as QueryResult<TResult>)
      .then(onfulfilled, onrejected);
  }
}

function sqlOp(op: string): string {
  switch (op) {
    case "eq":
      return "=";
    case "neq":
      return "!=";
    case "lt":
      return "<";
    case "gt":
      return ">";
    case "lte":
      return "<=";
    case "gte":
      return ">=";
    default:
      return "=";
  }
}

function decodeScalar(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw !== "") return n;
  return raw;
}

function errOf(e: unknown): PostgrestLikeError {
  const err = e as Error & { code?: string };
  return { message: err.message ?? String(e), code: err.code };
}

function primaryKeys(table: string): string[] {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
      pk: number;
    }[];
    return rows.filter((r) => r.pk > 0).map((r) => r.name);
  } catch {
    return ["id"];
  }
}

type DbCompat = {
  from<T extends TableName>(table: T): QueryBuilder<RowOf<T>>;
  from(table: string): QueryBuilder<Row>;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult<unknown>>;
};

let ready = false;

function makeClient(): DbCompat {
  if (!ready) {
    ensureSchema();
    ready = true;
  }
  const impl = {
    from(table: string): QueryBuilder<Row> {
      return new QueryBuilder(table);
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      return rpc(name, args) as PromiseLike<QueryResult<unknown>>;
    },
  };
  // The overloads above give callers row types straight from data-store.types.ts;
  // the implementation is row-agnostic.
  return impl as unknown as DbCompat;
}

let cached: DbCompat | null = null;

/** Local SQLite client with the PostgREST-ish surface the app already uses. */
export function getDataStore(): DbCompat {
  if (!cached) cached = makeClient();
  return cached;
}

export type { Json };
