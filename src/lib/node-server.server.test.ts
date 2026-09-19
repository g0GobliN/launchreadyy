/**
 * The Node front end is the one piece the SSR tests cannot cover: it decides whether
 * `npm start` answers a request at all, and it is the boundary where a path from the network
 * turns into a filesystem read.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cacheControlFor,
  contentTypeFor,
  isProcessEntry,
  resolveStaticFile,
  startNodeServer,
  toWebRequest,
  writeWebResponse,
} from "./node-server.server";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lr-client-"));
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(join(root, "logo"), { recursive: true });
  writeFileSync(join(root, "assets", "index-abc12345.js"), "console.log(1)");
  writeFileSync(join(root, "robots.txt"), "User-agent: *");
  writeFileSync(join(root, "logo", "mark.svg"), "<svg/>");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveStaticFile", () => {
  it("resolves a real file inside the root", async () => {
    expect(await resolveStaticFile("/robots.txt", root)).toBe(join(root, "robots.txt"));
    expect(await resolveStaticFile("/assets/index-abc12345.js", root)).toBe(
      join(root, "assets", "index-abc12345.js"),
    );
  });

  it("refuses to escape the root", async () => {
    expect(await resolveStaticFile("/../package.json", root)).toBeNull();
    expect(await resolveStaticFile("/assets/../../package.json", root)).toBeNull();
    expect(await resolveStaticFile("/%2e%2e%2fpackage.json", root)).toBeNull();
  });

  it("refuses NUL bytes and malformed encoding", async () => {
    expect(await resolveStaticFile("/robots.txt%00.png", root)).toBeNull();
    expect(await resolveStaticFile("/%E0%A4%A", root)).toBeNull();
  });

  it("returns null for a directory, a missing file and the root itself", async () => {
    expect(await resolveStaticFile("/assets", root)).toBeNull();
    expect(await resolveStaticFile("/nope.js", root)).toBeNull();
    expect(await resolveStaticFile("/", root)).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("maps the asset types this app ships", () => {
    expect(contentTypeFor("a.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("a.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("a.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("hero.webm")).toBe("video/webm");
    expect(contentTypeFor("sitemap.xml")).toBe("application/xml; charset=utf-8");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(contentTypeFor("file.bin")).toBe("application/octet-stream");
  });
});

describe("cacheControlFor", () => {
  it("marks hashed assets immutable", () => {
    expect(cacheControlFor("/assets/index-C2ensNR8.js")).toContain("immutable");
  });

  it("keeps HTML and other files revalidating", () => {
    expect(cacheControlFor("/")).toBe("no-store");
    expect(cacheControlFor("/robots.txt")).toBe("no-store");
  });
});

describe("toWebRequest", () => {
  /**
   * A real `IncomingMessage` *is* a Readable, so the fake has to be one too — otherwise
   * `Readable.toWeb()` (which the production path relies on) rejects it.
   */
  const fakeIncoming = (
    overrides: Partial<IncomingMessage> & { chunks?: string[] } = {},
  ): IncomingMessage => {
    const { chunks = [], ...rest } = overrides;
    // objectMode: false so chunks arrive as Buffers, like a real IncomingMessage — Readable.from
    // defaults to object mode, which fed raw strings into the web ReadableStream and broke it.
    return Object.assign(Readable.from(chunks, { objectMode: false }), {
      method: "GET",
      url: "/x?a=1",
      headers: { host: "example.test" },
      ...rest,
    }) as unknown as IncomingMessage;
  };

  it("builds an absolute URL, method and headers", () => {
    const request = toWebRequest(fakeIncoming(), "http://localhost:5174");
    expect(request.url).toBe("http://localhost:5174/x?a=1");
    expect(request.method).toBe("GET");
    expect(request.headers.get("host")).toBe("example.test");
  });

  it("repeats multi-value headers instead of dropping them", () => {
    const request = toWebRequest(
      fakeIncoming({ headers: { host: "h", "x-multi": ["a", "b"] } } as Partial<IncomingMessage>),
      "http://h",
    );
    expect(request.headers.get("x-multi")).toBe("a, b");
  });

  it("streams a body for methods that can carry one", async () => {
    const request = toWebRequest(fakeIncoming({ method: "POST", chunks: ["hello"] }), "http://h");
    expect(await request.text()).toBe("hello");
  });

  it("omits the body for GET", () => {
    expect(toWebRequest(fakeIncoming(), "http://h").body).toBeNull();
  });
});

describe("writeWebResponse", () => {
  function fakeOutgoing() {
    const headers = new Map<string, unknown>();
    const chunks: Buffer[] = [];
    // A real Writable: writeWebResponse pipes the body into it, so a stub without stream
    // semantics would test a code path that never exists in production.
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk as Buffer));
        cb();
      },
    }) as unknown as ServerResponse;
    res.statusCode = 0;
    res.setHeader = ((k: string, v: unknown) => {
      headers.set(k.toLowerCase(), v);
      return res;
    }) as ServerResponse["setHeader"];
    return { res, headers, chunks };
  }

  const bodyText = (chunks: Buffer[]) => Buffer.concat(chunks).toString("utf8");

  it("copies status, headers and body", async () => {
    const { res, headers, chunks } = fakeOutgoing();
    await writeWebResponse(res, new Response("hi", { status: 201, headers: { "x-test": "1" } }));
    expect(res.statusCode).toBe(201);
    expect(headers.get("x-test")).toBe("1");
    expect(bodyText(chunks)).toBe("hi");
  });

  it("preserves multiple Set-Cookie headers separately", async () => {
    const { res, headers } = fakeOutgoing();
    const response = new Response(null, { status: 200 });
    response.headers.append("set-cookie", "a=1");
    response.headers.append("set-cookie", "b=2");
    await writeWebResponse(res, response);
    expect(headers.get("set-cookie")).toEqual(["a=1", "b=2"]);
  });

  it("writes no body for 204", async () => {
    const { res, chunks } = fakeOutgoing();
    await writeWebResponse(res, new Response(null, { status: 204 }));
    expect(res.statusCode).toBe(204);
    expect(chunks).toEqual([]);
  });
});

describe("startNodeServer", () => {
  // These hit a real socket, so full-suite parallelism (dozens of workers competing for the
  // event loop) can push them past the global 15s timeout even though each is fast in isolation.
  it("serves static files without touching the request pipeline", async () => {
    let pipelineCalls = 0;
    const server = await startNodeServer({
      handleRequest: async () => {
        pipelineCalls++;
        return new Response("ssr");
      },
      port: 0,
      host: "127.0.0.1",
      clientDir: root,
    });

    try {
      const res = await fetch(`${server.url}/robots.txt`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("User-agent: *");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(pipelineCalls).toBe(0);

      const asset = await fetch(`${server.url}/assets/index-abc12345.js`);
      expect(await asset.text()).toBe("console.log(1)");
      expect(asset.headers.get("cache-control")).toContain("immutable");
    } finally {
      await server.close();
    }
  }, 30_000);

  it("falls through to the request pipeline for non-asset paths", async () => {
    const seen: string[] = [];
    const server = await startNodeServer({
      handleRequest: async (request) => {
        seen.push(new URL(request.url).pathname);
        return new Response("ssr-page", { headers: { "x-rendered": "yes" } });
      },
      port: 0,
      host: "127.0.0.1",
      clientDir: root,
    });

    try {
      const res = await fetch(`${server.url}/dashboard`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ssr-page");
      expect(res.headers.get("x-rendered")).toBe("yes");
      expect(seen).toEqual(["/dashboard"]);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("answers 500 instead of hanging when the pipeline throws", async () => {
    const server = await startNodeServer({
      handleRequest: async () => {
        throw new Error("boom");
      },
      port: 0,
      host: "127.0.0.1",
      clientDir: root,
    });

    try {
      const res = await fetch(`${server.url}/explode`);
      expect(res.status).toBe(500);
    } finally {
      await server.close();
    }
  }, 30_000);
});

describe("isProcessEntry", () => {
  it("is false when this module is merely imported by a test runner", () => {
    expect(isProcessEntry(import.meta.url)).toBe(false);
  });

  it("is true when moduleUrl matches process.argv[1] (the real npm-start shape)", () => {
    const prevArgv1 = process.argv[1];
    process.argv[1] = "/app/dist/server/server.js";
    try {
      expect(isProcessEntry("file:///app/dist/server/server.js")).toBe(true);
    } finally {
      process.argv[1] = prevArgv1;
    }
  });

  it("is false when moduleUrl is a different chunk than the invoked entry file", () => {
    // The bug this guards: a helper split into its own chunk measuring its own import.meta.url
    // instead of the caller's would compare the chunk's path against argv[1] and never match.
    const prevArgv1 = process.argv[1];
    process.argv[1] = "/app/dist/server/server.js";
    try {
      expect(isProcessEntry("file:///app/dist/server/assets/node-server.server-XYZ.js")).toBe(
        false,
      );
    } finally {
      process.argv[1] = prevArgv1;
    }
  });

  it("is true when the explicit serve flag is set", () => {
    const prev = process.env.LAUNCHREADYY_SERVE;
    process.env.LAUNCHREADYY_SERVE = "1";
    try {
      expect(isProcessEntry(import.meta.url)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.LAUNCHREADYY_SERVE;
      else process.env.LAUNCHREADYY_SERVE = prev;
    }
  });
});
