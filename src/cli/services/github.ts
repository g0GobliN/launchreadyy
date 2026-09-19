export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

export interface TokenValidationResult {
  valid: boolean;
  user?: GitHubUser;
  scopes?: string[];
  error?: string;
}

const REQUIRED_SCOPES = ["repo", "read:user", "workflow"];

export async function validateGitHubToken(token: string): Promise<TokenValidationResult> {
  if (!token || token.trim() === "") {
    return { valid: false, error: "Token is empty" };
  }

  const cleanToken = token.trim();

  try {
    // First, check the token by getting the authenticated user
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "LaunchReadyy-CLI",
      },
    });

    if (!userResponse.ok) {
      if (userResponse.status === 401) {
        return { valid: false, error: "Invalid token (401 Unauthorized)" };
      }
      if (userResponse.status === 403) {
        return { valid: false, error: "Token forbidden (403) - may have expired or been revoked" };
      }
      return {
        valid: false,
        error: `GitHub API error: ${userResponse.status} ${userResponse.statusText}`,
      };
    }

    const user = (await userResponse.json()) as GitHubUser;

    // Check scopes by making a request to an endpoint that requires repo scope
    // We'll check the scopes from the OAuth token info
    const scopesResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "LaunchReadyy-CLI",
      },
    });

    // Get scopes from response headers
    const scopesHeader =
      scopesResponse.headers.get("x-oauth-scopes") ||
      scopesResponse.headers.get("x-accepted-oauth-scopes") ||
      "";
    const scopes = scopesHeader
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Check required scopes
    const missingScopes = REQUIRED_SCOPES.filter(
      (required) => !scopes.some((s) => s.includes(required)),
    );

    if (missingScopes.length > 0) {
      return {
        valid: false,
        user,
        scopes,
        error:
          `Token missing required scopes: ${missingScopes.join(", ")}. ` +
          `Create a token at https://github.com/settings/tokens with scopes: ${REQUIRED_SCOPES.join(", ")}`,
      };
    }

    return { valid: true, user, scopes };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return { valid: false, error: "Network error - check your internet connection" };
    }
    return {
      valid: false,
      error: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function getTokenSetupUrl(): string {
  return "https://github.com/settings/tokens/new?scopes=repo,read:user,workflow&description=LaunchReadyy%20Community";
}

export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}
