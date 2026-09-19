import {
  type LanguageManifests,
  javaVersionFromBuildFiles,
} from "../../../../project-context.server";

export const JAR_PICK =
  'JAR=$(ls -S target/*.jar target/*.war build/libs/*.jar 2>/dev/null | grep -viE "(sources|javadoc|plain)\\.jar$" | head -n1) && cp "$JAR" app.jar';

export function javaDockerJdkTag(manifests: Partial<LanguageManifests>): string {
  const declared = parseInt(javaVersionFromBuildFiles(manifests.pomXml, manifests.buildGradle), 10);
  return String(Math.max(Number.isFinite(declared) ? declared : 21, 8));
}

export function javaDockerBuildJdkTag(manifests: Partial<LanguageManifests>): string {
  // Current Java 8 clients can fail TLS negotiation with Maven Central, while old Maven/Spring
  // plugins fail under Java 17+'s strong module encapsulation. JDK 11 is the compatible builder
  // for legacy (<=8) targets; the runner still uses the repo's declared bytecode level.
  return String(Math.max(parseInt(javaDockerJdkTag(manifests), 10), 11));
}

export function dockerfileJava(manifests: Partial<LanguageManifests>): string {
  const buildJdk = javaDockerBuildJdkTag(manifests);
  const runtimeJdk = javaDockerJdkTag(manifests);
  return `FROM eclipse-temurin:${buildJdk}-jdk-alpine AS build
WORKDIR /app
RUN apk add --no-cache maven
COPY . .
# Same masked-fallback problem the Kotlin template had: the 2>/dev/null chain swallowed the
# wrapper's real error and fell through to a tool that could not work, reporting a misleading
# failure instead. Run through sh so a wrapper missing its exec bit or carrying CRLF line
# endings still runs. Maven-first here because a Java repo with both wrappers is usually
# Maven-built.
RUN sed -i 's/\r$//' ./gradlew ./mvnw 2>/dev/null || true
RUN if [ -f ./mvnw ]; then sh ./mvnw package -DskipTests; \\
    elif [ -f ./gradlew ]; then sh ./gradlew bootJar -x test; \\
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
