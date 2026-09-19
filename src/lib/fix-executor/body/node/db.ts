export const DB_POOL = `import Pool from "pg-pool";

// A single shared pool — do not create a new Pool per request.
// Pool size defaults to 10; tune with DATABASE_POOL_SIZE env var.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
  // rejectUnauthorized: true validates the server cert (recommended for managed DBs like RDS, Neon, Supabase).
  // Set to false only if your DB uses a self-signed cert — and never in production without rotating secrets first.
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false,
});

pool.on("error", (err) => {
  console.error("Unexpected pool error", err);
});

export const db = pool;
export const query = pool.query.bind(pool);
`;
