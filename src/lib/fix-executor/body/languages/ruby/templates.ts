export const SECURITY_HEADERS_RUBY = `# frozen_string_literal: true

module Middleware
  class SecurityHeaders
    def initialize(app)
      @app = app
    end

    def call(env)
      status, headers, body = @app.call(env)
      headers["X-Content-Type-Options"] = "nosniff"
      headers["X-Frame-Options"] = "DENY"
      headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
      [status, headers, body]
    end
  end
end
`;

export const CORS_RUBY = `# frozen_string_literal: true

module Middleware
  class Cors
    def initialize(app)
      @app = app
    end

    def call(env)
      status, headers, body = @app.call(env)
      origin = env["HTTP_ORIGIN"]
      headers["Access-Control-Allow-Origin"] = origin if origin
      headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
      return [204, headers, []] if env["REQUEST_METHOD"] == "OPTIONS"
      [status, headers, body]
    end
  end
end
`;

export const RATE_LIMIT_RUBY = `# frozen_string_literal: true

module Middleware
  class RateLimit
    WINDOW = 900
    MAX = 100

    def initialize(app)
      @app = app
      @hits = Hash.new { |h, k| h[k] = [] }
    end

    def call(env)
      key = env["REMOTE_ADDR"]
      now = Time.now.to_i
      @hits[key].reject! { |t| now - t > WINDOW }
      if @hits[key].size >= MAX
        return [429, { "Content-Type" => "application/json" }, ['{"error":"Too many requests"}']]
      end
      @hits[key] << now
      @app.call(env)
    end
  end
end
`;

export const LOGGER_RUBY = `# frozen_string_literal: true

module Middleware
  class RequestLogger
    def initialize(app)
      @app = app
    end

    def call(env)
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      status, headers, body = @app.call(env)
      duration = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
      Rails.logger.info("#{env['REQUEST_METHOD']} #{env['PATH_INFO']} #{duration.round(3)}s") if defined?(Rails)
      [status, headers, body]
    end
  end
end
`;

export const SENTRY_INIT_RUBY = `Sentry.init do |config|
  config.dsn = ENV["SENTRY_DSN"]
  config.environment = ENV.fetch("RAILS_ENV", "production")
  config.release = ENV["APP_VERSION"]
  config.breadcrumbs_logger = [:active_support_logger, :http_logger]
  config.traces_sample_rate = ENV["RAILS_ENV"] == "production" ? 0.1 : 0.0
end
`;

export const HEALTH_CHECK_RUBY = `# Health check — add to config/routes.rb:
#   get "/health", to: "health#show"
# or mount directly in config.ru:
#   map "/health" do
#     run ->(env) { [200, {"Content-Type" => "application/json"}, ['{"status":"ok"}']] }
#   end

class HealthController < ApplicationController
  def show
    render json: { status: "ok", uptime: Process.clock_gettime(Process::CLOCK_MONOTONIC) }
  end
end
`;
