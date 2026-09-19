import { describe, expect, it } from "vitest";
import { detectFramework, detectLanguage } from "./scanner-rules";
import { isAutomatedFixSupported } from "./project-context";

describe("platform stack detection", () => {
  it("detects Expo from package.json", () => {
    expect(
      detectFramework({
        dependencies: { expo: "51.0.0", react: "18.3.0", "react-native": "0.74.0" },
      }),
    ).toBe("Expo");
  });

  it("detects Electron", () => {
    expect(detectFramework({ devDependencies: { electron: "30.0.0" } })).toBe("Electron");
  });

  it("detects Flutter from pubspec", () => {
    expect(detectLanguage(["pubspec.yaml", "lib/main.dart"])).toBe("Flutter");
  });

  it("detects Swift from Package.swift", () => {
    expect(detectLanguage(["Package.swift", "Sources/App/main.swift"])).toBe("Swift");
  });

  it("allows static HTML repos for basic launch checks", () => {
    expect(isAutomatedFixSupported(["index.html", "styles.css"])).toBe(true);
  });
});
