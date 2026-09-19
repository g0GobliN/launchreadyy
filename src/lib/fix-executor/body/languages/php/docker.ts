export function dockerfilePhp(filePaths: string[]): string {
  const docRoot = filePaths.includes("public/index.php") ? "public" : ".";
  return `FROM php:8.3-cli-alpine AS build
WORKDIR /app
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY composer.json composer.lock* ./
# --no-scripts: Symfony Flex's default composer.json ships a post-install-cmd (@auto-scripts,
# including cache:clear) that shells out to bin/console — but this stage only copies the
# manifests, not the app source, so bin/console doesn't exist yet. Confirmed against the real
# symfony/demo: without --no-scripts, "composer install" itself fails here ("Could not open
# input file: ./bin/console"). Skipping scripts is safe — this stage's only job is producing
# vendor/ for the runtime stage below, which happens independently of composer's lifecycle hooks.
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts

FROM php:8.3-cli-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app
RUN (getent group app || addgroup -S app) && (getent passwd app || adduser -S app -G app)
COPY --from=build /app/vendor ./vendor
COPY . .
RUN chown -R app:app /app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:8080/ || exit 1
CMD ["php", "-S", "0.0.0.0:8080", "-t", "${docRoot}"]
`;
}
