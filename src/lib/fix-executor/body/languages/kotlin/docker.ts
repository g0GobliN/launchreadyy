import { type LanguageManifests } from "../../../../project-context.server";
import { javaDockerBuildJdkTag, javaDockerJdkTag, JAR_PICK } from "../../languages/java/docker";

export function dockerfileKotlin(manifests: Partial<LanguageManifests>): string {
  const buildJdk = javaDockerBuildJdkTag(manifests);
  const runtimeJdk = javaDockerJdkTag(manifests);
  return `FROM eclipse-temurin:${buildJdk}-jdk-alpine AS build
WORKDIR /app
RUN apk add --no-cache maven
COPY . .
# Pick the build tool the repo actually has, rather than chaining fallbacks with 2>/dev/null.
# That chain hid the real failure: on a Gradle project the wrapper failed silently, execution fell
# through to Maven, and the build died with the misleading "no POM in this directory".
#
# Invoked through sh rather than as ./gradlew, which sidesteps the two ways a committed wrapper
# refuses to execute: a missing exec bit (git does not preserve it on Windows checkouts, and
# plenty of repos never set it) and CRLF line endings, where the kernel reads the shebang as
# "/bin/sh\r", cannot find it, and exits 127. Both were hit on real fixtures here.
RUN sed -i 's/\r$//' ./gradlew ./mvnw 2>/dev/null || true
RUN if [ -f ./gradlew ]; then sh ./gradlew bootJar -x test; \\
    elif [ -f ./mvnw ]; then sh ./mvnw package -DskipTests; \\
    else mvn package -DskipTests; fi
RUN ${JAR_PICK}

FROM eclipse-temurin:${runtimeJdk}-jre-alpine AS runner
WORKDIR /app
RUN (getent group app || addgroup -S app) && (getent passwd app || adduser -S app -G app)
COPY --from=build /app/app.jar app.jar
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:8080/actuator/health || wget -qO- http://localhost:8080/health || exit 1
CMD ["java", "-jar", "app.jar"]
`;
}
