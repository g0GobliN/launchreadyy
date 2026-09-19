/** Mobile, desktop, and native stacks recognized by the scanner. */

export const MOBILE_DESKTOP_FRAMEWORKS = new Set([
  "Expo",
  "React Native",
  "Electron",
  "Tauri",
  "Flutter",
  "Swift",
  "Kotlin",
]);

export const NATIVE_FRAMEWORKS = new Set(["Flutter", "Swift", "Kotlin"]);

export function isMobileDesktopFramework(framework: string): boolean {
  return MOBILE_DESKTOP_FRAMEWORKS.has(framework);
}

export function isNativeMobileFramework(framework: string): boolean {
  return NATIVE_FRAMEWORKS.has(framework);
}
