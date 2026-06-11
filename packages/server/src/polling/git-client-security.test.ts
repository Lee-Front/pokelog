import { describe, it, expect } from "vitest";
import {
  resolveRepoUrl,
  redactUrlCredentials,
  buildTlsConfigArgs,
} from "./git-client.js";

describe("resolveRepoUrl (GitLab HTTPS PAT format)", () => {
  it("injects oauth2:<token>@ for token auth mode", () => {
    const out = resolveRepoUrl(
      "https://gitlab.example.com/group/repo.git",
      "token",
      "glpat-abcDEF123456",
    );
    // GitLab accepts https://oauth2:<PAT>@host for HTTPS clones.
    expect(out).toBe("https://oauth2:glpat-abcDEF123456@gitlab.example.com/group/repo.git");
  });

  it("leaves the URL untouched in public mode", () => {
    const url = "https://gitlab.example.com/group/repo.git";
    expect(resolveRepoUrl(url, "public")).toBe(url);
    expect(resolveRepoUrl(url)).toBe(url);
  });

  it("does not inject when token is missing even in token mode", () => {
    const url = "https://gitlab.example.com/group/repo.git";
    expect(resolveRepoUrl(url, "token")).toBe(url);
  });

  it("url-encodes token characters that are not URL-safe", () => {
    const out = resolveRepoUrl(
      "https://gitlab.example.com/group/repo.git",
      "token",
      "tok/with+special=chars",
    );
    // WHATWG URL percent-encodes reserved chars in the password component.
    expect(out).toContain("@gitlab.example.com/group/repo.git");
    expect(out.startsWith("https://oauth2:")).toBe(true);
    // The raw special chars must not appear literally in the userinfo segment.
    expect(out).not.toContain(":tok/with+special=chars@");
  });

  it("returns the original string when the URL cannot be parsed", () => {
    expect(resolveRepoUrl("not a url", "token", "tok")).toBe("not a url");
  });
});

describe("redactUrlCredentials (token leak prevention)", () => {
  it("strips userinfo from the exact execFile error leak", () => {
    const leak =
      "Command failed: git ls-remote --heads https://oauth2:SECRET_TOKEN_12345@gitlab.example.com/repo.git\n" +
      "fatal: unable to access ...";
    const redacted = redactUrlCredentials(leak);
    expect(redacted).not.toContain("SECRET_TOKEN_12345");
    expect(redacted).toContain("https://***@gitlab.example.com/repo.git");
  });

  it("redacts userinfo regardless of username", () => {
    expect(redactUrlCredentials("https://anyuser:tok@host/x")).toBe("https://***@host/x");
  });

  it("redacts multiple URLs in one string", () => {
    const input =
      "first https://a:1@h1/r and second https://b:2@h2/r failed";
    const out = redactUrlCredentials(input);
    expect(out).not.toMatch(/:1@|:2@/);
    expect(out).toContain("https://***@h1/r");
    expect(out).toContain("https://***@h2/r");
  });

  it("leaves credential-free URLs and plain text untouched", () => {
    expect(redactUrlCredentials("https://gitlab.example.com/repo.git")).toBe(
      "https://gitlab.example.com/repo.git",
    );
    expect(redactUrlCredentials("no urls here")).toBe("no urls here");
  });
});

describe("buildTlsConfigArgs", () => {
  it("returns no args when no TLS options are given", () => {
    expect(buildTlsConfigArgs()).toEqual([]);
    expect(buildTlsConfigArgs({})).toEqual([]);
  });

  it("points git at a private CA bundle", () => {
    expect(buildTlsConfigArgs({ caCertPath: "/etc/ssl/corp-ca.pem" })).toEqual([
      "-c",
      "http.sslCAInfo=/etc/ssl/corp-ca.pem",
    ]);
  });

  it("disables verification when insecureSkipTls is set", () => {
    expect(buildTlsConfigArgs({ insecureSkipTls: true })).toEqual([
      "-c",
      "http.sslVerify=false",
    ]);
  });

  it("prefers insecureSkipTls over caCertPath when both are set", () => {
    expect(
      buildTlsConfigArgs({ caCertPath: "/etc/ssl/corp-ca.pem", insecureSkipTls: true }),
    ).toEqual(["-c", "http.sslVerify=false"]);
  });
});
