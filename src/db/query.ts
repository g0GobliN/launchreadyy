import { db } from "./client";
import { ensureSchema } from "./schema";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

function safeParseJson<T = unknown>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const FOREIGN_KEYS: Record<string, Record<string, string>> = {
  fix_requests: { repos: "repo_id" },
  scans: { repos: "repo_id" },
  sandbox_verify_runs: { repos: "repo_id", fix_requests: "fix_request_id" },
  live_site_scans: { repos: "repo_id", scans: "scan_id" },
  domain_scan_confirmations: { scans: "scan_id" },
  repo_knowledge_facts: { repo_knowledge_facts: "superseded_by" },
  fix_recoveries: { fix_requests: "fix_request_id" },
  background_jobs: {},
  repo_monitors: { repos: "repo_id" },
  live_site_monitors: { repos: "repo_id" },
  project_env_vars: { repos: "repo_id" },
  project_build_settings: { repos: "repo_id" },
  sandbox_audit_log: { repos: "repo_id" },
};

type QueryResult<T> = { data: T; error: { message: string; code?: string } | null; count?: number };

class QueryBuilder<TData = unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private filters: Array<{ column: string; op: string; value: any }> = [];
  private selectedFields = "*";
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private isSingle = false;
  private isMaybeSingle = false;
  private headCount = false;

  constructor(private table: string) {}

  select(fields: string, options?: { count?: string; head?: boolean }): QueryBuilder<TData> {
    this.selectedFields = fields;
    if (options?.head) {
      this.headCount = true;
    }
    return this;
  }

  insert(data: unknown): QueryBuilder<TData> {
    this._insertData = data;
    return this;
  }

  update(data: unknown): QueryBuilder<TData> {
    this._updateData = data;
    return this;
  }

  delete(): QueryBuilder<TData> {
    this._delete = true;
    return this;
  }

  eq(column: string, value: unknown): QueryBuilder<TData> {
    this.filters.push({ column, op: "=", value });
    return this;
  }

  neq(column: string, value: unknown): QueryBuilder<TData> {
    this.filters.push({ column, op: "!=", value });
    return this;
  }

  not(column: string, op: string, value: unknown): QueryBuilder<TData> {
    if (op === "is") {
      if (value === null) {
        this.filters.push({ column, op: "is not", value });
      } else {
        this.filters.push({ column, op: "is not", value });
      }
    } else {
      this.filters.push({ column, op: `not_${op}`, value });
    }
    return this;
  }

  lt(column: string, value: unknown): QueryBuilder<TData> {
    this.filters.push({ column, op: "<", value });
    return this;
  }

  gt(column: string, value: unknown): QueryBuilder<TData> {
    this.filters.push({ column, op: ">", value });
    return this;
  }

  gte(column: string, value: unknown): QueryBuilder<TData> {
    this.filters.push({ column, op: ">=", value });
    return this;
  }

  upsert(data: unknown, options?: { onConflict?: string }): QueryBuilder<TData> {
    this._upsertData = data;
    this._upsert = true;
    this._upsertOptions = options;
    return this;
  }

  in(column: string, values: unknown[]): QueryBuilder<TData> {
    this.filters.push({ column, op: "in", value: values });
    return this;
  }

  is(column: string, value: unknown): QueryBuilder<TData> {
    this.filters.push({ column, op: "is", value });
    return this;
  }

  or(filters: string): QueryBuilder<TData> {
    this.filters.push({ column: "__or__", op: "raw", value: filters });
    return this;
  }

  order(column: string, opts: { ascending?: boolean } = {}): QueryBuilder<TData> {
    this.orderBy = { column, ascending: opts.ascending ?? true };
    return this;
  }

  limit(count: number): QueryBuilder<TData> {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number): QueryBuilder<TData> {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  single(): QueryBuilder<TData> {
    this.isSingle = true;
    return this;
  }

  maybeSingle(): QueryBuilder<TData> {
    this.isMaybeSingle = true;
    return this;
  }

  returns<TNew = TData>(): QueryBuilder<TNew> {
    return this as unknown as QueryBuilder<TNew>;
  }

  rpc(name: string, args: Record<string, unknown> = {}): QueryBuilder<TData> {
    this._rpcName = name;
    this._rpcArgs = args;
    return this;
  }

  private _insertData: unknown = null;
  private _updateData: unknown = null;
  private _upsertData: unknown = null;
  private _upsert = false;
  private _upsertOptions: { onConflict?: string } | undefined;
  private _delete = false;
  private _rpcName: string | null = null;
  private _rpcArgs: Record<string, unknown> = {};

  private buildWhereClause(): { sql: string; params: unknown[] } {
    if (this.filters.length === 0) return { sql: "", params: [] };

    const clauses: string[] = [];
    const params: unknown[] = [];

    for (const f of this.filters) {
      if (f.column === "__or__") {
        clauses.push(`(${f.value})`);
      } else if (f.op === "in") {
        const vals = Array.isArray(f.value) ? f.value : [f.value];
        const placeholders = vals.map(() => "?").join(", ");
        clauses.push(`${f.column} IN (${placeholders})`);
        params.push(...vals);
      } else if (f.op === "is") {
        if (f.value === null) {
          clauses.push(`${f.column} IS NULL`);
        } else {
          clauses.push(`${f.column} IS ?`);
          params.push(f.value);
        }
      } else if (f.op === "is not") {
        if (f.value === null) {
          clauses.push(`${f.column} IS NOT NULL`);
        } else {
          clauses.push(`${f.column} IS NOT ?`);
          params.push(f.value);
        }
      } else if (f.op === "not_=") {
        clauses.push(`${f.column} != ?`);
        params.push(f.value);
      } else if (f.op === "not_in") {
        const vals = Array.isArray(f.value) ? f.value : [f.value];
        const placeholders = vals.map(() => "?").join(", ");
        clauses.push(`${f.column} NOT IN (${placeholders})`);
        params.push(...vals);
      } else {
        clauses.push(`${f.column} ${f.op} ?`);
        params.push(f.value);
      }
    }

    return { sql: `WHERE ${clauses.join(" AND ")}`, params };
  }

  private buildSelectColumns(): { columns: string; joins: string } {
    if (this.selectedFields === "*") {
      return { columns: `${this.table}.*`, joins: "" };
    }

    const parts = this.selectedFields.split(",").map((s) => s.trim());
    const columns: string[] = [];
    const joins: string[] = [];
    const seenJoins = new Set<string>();

    for (const part of parts) {
      const foreignMatch = part.match(/^(\w+)\(([^)]+)\)$/);
      if (foreignMatch) {
        const [, tableName, fields] = foreignMatch;
        const fieldList = fields
          .split(",")
          .map((f) => f.trim())
          .join(", ");

        const fkMap = FOREIGN_KEYS[this.table] || {};
        const fkColumn = fkMap[tableName];
        if (fkColumn && !seenJoins.has(tableName)) {
          seenJoins.add(tableName);
          joins.push(`LEFT JOIN ${tableName} ON ${this.table}.${fkColumn} = ${tableName}.id`);
        }

        columns.push(`${tableName}.${fieldList}`);
      } else if (part === "*") {
        columns.push(`${this.table}.*`);
      } else {
        columns.push(part);
      }
    }

    return {
      columns: columns.join(", "),
      joins: joins.join(" "),
    };
  }

  private executeSelect(): {
    data: TData[];
    error: { message: string; code?: string } | null;
    count?: number;
  } {
    const { columns, joins } = this.buildSelectColumns();
    const { sql: whereSql, params } = this.buildWhereClause();

    let orderSql = "";
    if (this.orderBy) {
      orderSql = ` ORDER BY ${this.orderBy.column} ${this.orderBy.ascending ? "ASC" : "DESC"}`;
    }

    let limitSql = "";
    if (this.limitCount !== null) {
      limitSql = ` LIMIT ${this.limitCount}`;
    }

    let rangeSql = "";
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      rangeSql = ` LIMIT ${this.rangeTo - this.rangeFrom + 1} OFFSET ${this.rangeFrom}`;
    }

    if (this.headCount) {
      const countSql = `SELECT COUNT(*) as count FROM ${this.table} ${joins} ${whereSql}`;
      try {
        const row = db.prepare(countSql).get(...params) as { count: number };
        return { data: [] as TData[], error: null, count: row.count };
      } catch (e) {
        return { data: [] as TData[], error: { message: (e as Error).message }, count: 0 };
      }
    }

    const sql = `SELECT ${columns} FROM ${this.table} ${joins} ${whereSql}${orderSql}${rangeSql}${limitSql}`;

    try {
      const rows = db.prepare(sql).all(...params) as TData[];
      return { data: rows, error: null };
    } catch (e) {
      return { data: [] as TData[], error: { message: (e as Error).message } };
    }
  }

  private executeInsert(): {
    data: TData | null;
    error: { message: string; code?: string } | null;
  } {
    const data = this._insertData as Record<string, unknown>;
    if (!data) return { data: null, error: { message: "No data to insert" } };

    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => "?").join(", ");

    const sql = `INSERT INTO ${this.table} (${keys.join(", ")}) VALUES (${placeholders})`;

    try {
      const result = db.prepare(sql).run(...values);
      const lastId = result.lastInsertRowid as number;
      const row = db.prepare(`SELECT * FROM ${this.table} WHERE rowid = ?`).get(lastId) as TData;
      return { data: row, error: null };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  private executeUpsert(): {
    data: TData | null;
    error: { message: string; code?: string } | null;
  } {
    const data = this._upsertData as Record<string, unknown>;
    if (!data) return { data: null, error: { message: "No data to upsert" } };

    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => "?").join(", ");

    // Use INSERT OR REPLACE for upsert behavior
    const sql = `INSERT OR REPLACE INTO ${this.table} (${keys.join(", ")}) VALUES (${placeholders})`;

    try {
      const result = db.prepare(sql).run(...values);
      const lastId = result.lastInsertRowid as number;
      const row = db.prepare(`SELECT * FROM ${this.table} WHERE rowid = ?`).get(lastId) as TData;
      return { data: row, error: null };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  private executeUpdate(): {
    data: TData | null;
    error: { message: string; code?: string } | null;
  } {
    const data = this._updateData as Record<string, unknown>;
    if (!data) return { data: null, error: { message: "No data to update" } };

    const { sql: whereSql, params: whereParams } = this.buildWhereClause();
    const setClauses = Object.keys(data)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = Object.values(data);

    const sql = `UPDATE ${this.table} SET ${setClauses} ${whereSql}`;

    try {
      db.prepare(sql).run(...values, ...whereParams);
      return { data: null, error: null };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  private executeDelete(): {
    data: TData | null;
    error: { message: string; code?: string } | null;
  } {
    const { sql: whereSql, params } = this.buildWhereClause();
    const sql = `DELETE FROM ${this.table} ${whereSql}`;

    try {
      db.prepare(sql).run(...params);
      return { data: null, error: null };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  private executeRpc(): { data: TData; error: { message: string } | null } {
    return {
      data: null as TData,
      error: { message: `RPC ${this._rpcName} not implemented in SQLite mode` },
    };
  }

  async execute(): Promise<QueryResult<TData | null>> {
    let result: {
      data: TData | TData[] | null;
      error: { message: string; code?: string } | null;
      count?: number;
    };

    if (this._rpcName) {
      result = this.executeRpc();
    } else if (this._upsert) {
      result = this.executeUpsert();
    } else if (this._insertData && !this._updateData && !this._delete) {
      result = this.executeInsert();
    } else if (this._updateData && !this._delete) {
      result = this.executeUpdate();
    } else if (this._delete) {
      result = this.executeDelete();
    } else {
      result = this.executeSelect();
    }

    let data = result.data;
    if (this.isSingle || this.isMaybeSingle) {
      const arr = Array.isArray(data) ? data : [];
      if (arr.length > 1 && this.isSingle) {
        return { data: null, error: { message: "More than one row returned" } };
      }
      data = arr[0] ?? null;
      if (this.isMaybeSingle && !data) {
        return { data: null, error: null };
      }
    }

    return { data: data as TData | null, error: result.error, count: result.count };
  }

  then(
    resolve: (value: QueryResult<TData | null>) => void,
    reject?: (reason: unknown) => void,
  ): void {
    this.execute()
      .then((result) => {
        resolve({
          data: result.data as TData | null,
          error: result.error,
          count: result.count,
        });
      })
      .catch(reject);
  }
}

class DbCompat {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from<T = any>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc<T = any>(name: string, args: Record<string, unknown> = {}): QueryBuilder<T> {
    return new QueryBuilder<T>("__rpc__").rpc(name, args);
  }

  async auth() {
    return {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    };
  }

  channel() {
    return {
      on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    };
  }
}

let schemaInitialized = false;
let instance: DbCompat | null = null;

export function query(): DbCompat {
  if (!instance) {
    if (!schemaInitialized) {
      ensureSchema();
      schemaInitialized = true;
    }
    instance = new DbCompat();
  }
  return instance;
}
