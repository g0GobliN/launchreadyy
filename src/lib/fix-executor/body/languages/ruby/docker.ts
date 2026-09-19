export function dockerfileRuby(filePaths: string[], gemfile: string): string {
  const isRails =
    filePaths.includes("config/application.rb") || /^\s*gem ["']rails["']/im.test(gemfile);
  const hasConfigRu = filePaths.includes("config.ru");
  const startCmd = isRails
    ? '["bundle", "exec", "rails", "server", "-b", "0.0.0.0", "-p", "3000"]'
    : hasConfigRu
      ? '["bundle", "exec", "rackup", "--host", "0.0.0.0", "-p", "3000"]'
      : '["bundle", "exec", "ruby", "app.rb"]';
  return `FROM ruby:3.3-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev libsqlite3-dev && rm -rf /var/lib/apt/lists/*
COPY Gemfile Gemfile.lock ./
RUN bundle config set --local deployment true && bundle install --jobs 4 --retry 3

FROM ruby:3.3-slim AS runner
WORKDIR /app
ENV RAILS_ENV=production RACK_ENV=production
RUN groupadd --system app && useradd --system --gid app --no-create-home app
COPY --from=build /usr/local/bundle /usr/local/bundle
COPY . .
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/health || exit 1
CMD ${startCmd}
`;
}
