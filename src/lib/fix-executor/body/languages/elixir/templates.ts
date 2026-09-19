export const SECURITY_HEADERS_ELIXIR = `defmodule AppWeb.Plugs.SecurityHeaders do
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    conn
    |> put_resp_header("x-content-type-options", "nosniff")
    |> put_resp_header("x-frame-options", "DENY")
    |> put_resp_header("referrer-policy", "strict-origin-when-cross-origin")
  end
end
`;

export const CORS_ELIXIR = `defmodule AppWeb.Plugs.Cors do
  import Plug.Conn

  def init(opts), do: opts

  def call(%{method: "OPTIONS"} = conn, _opts) do
    conn
    |> put_cors_headers()
    |> send_resp(204, "")
    |> halt()
  end

  def call(conn, _opts), do: put_cors_headers(conn)

  defp put_cors_headers(conn) do
    origin = get_req_header(conn, "origin") |> List.first() || System.get_env("ALLOWED_ORIGINS", "*")
    conn
    |> put_resp_header("access-control-allow-origin", origin)
    |> put_resp_header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    |> put_resp_header("access-control-allow-headers", "content-type, authorization")
  end
end
`;

export const RATE_LIMIT_ELIXIR = `defmodule AppWeb.Plugs.RateLimit do
  import Plug.Conn

  @table :app_rate_limit
  @window_ms 900_000
  @max 100

  def init(opts) do
    if :ets.whereis(@table) == :undefined, do: :ets.new(@table, [:named_table, :public, read_concurrency: true])
    opts
  end

  def call(conn, _opts) do
    key = conn.remote_ip |> Tuple.to_list() |> Enum.join(".")
    now = System.monotonic_time(:millisecond)
    hits =
      case :ets.lookup(@table, key) do
        [{^key, ts}] -> Enum.filter(ts, &(now - &1 < @window_ms))
        _ -> []
      end

    if length(hits) >= @max do
      conn |> put_resp_content_type("application/json") |> send_resp(429, ~s({"error":"Too many requests"})) |> halt()
    else
      :ets.insert(@table, {key, [now | hits]})
      conn
    end
  end
end
`;

export const LOGGER_ELIXIR = `defmodule AppWeb.Plugs.RequestLogger do
  require Logger
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    started = System.monotonic_time(:millisecond)
    conn = register_before_send(conn, fn conn ->
      duration = System.monotonic_time(:millisecond) - started
      Logger.info("#{conn.method} #{conn.request_path} #{conn.status} #{duration}ms")
      conn
    end)
    conn
  end
end
`;

export const HEALTH_CONTROLLER_ELIXIR = `defmodule AppWeb.HealthController do
  use AppWeb, :controller

  def index(conn, _params) do
    json(conn, %{status: "ok"})
  end
end
`;

export const SENTRY_INIT_ELIXIR = `import Config

config :sentry,
  dsn: System.get_env("SENTRY_DSN"),
  environment_name: config_env(),
  enable_source_code_context: true,
  root_source_code_paths: [File.cwd!()]
`;
