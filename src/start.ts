import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";
import { isNotFound, isRedirect } from "@tanstack/router-core";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next, context }) => {
  try {
    return await next();
  } catch (error) {
    if (isNotFound(error) || isRedirect(error)) {
      throw error;
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    // Server functions must surface JSON errors to the client — not the HTML fallback page.
    if ((context as unknown as { handlerType?: string }).handlerType === "serverFn") {
      throw error;
    }
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, errorMiddleware],
}));
