export function normalizeBasstokOrigin(value: string): string {
  if (value.length === 0 || Buffer.byteLength(value, "utf8") > 2_048) {
    throw new Error("Basstok URL is invalid");
  }
  const url = new URL(value);
  if (url.username !== "" || url.password !== "" || url.pathname !== "/" ||
      url.search !== "" || url.hash !== "") {
    throw new Error("Basstok URL must be an origin without credentials or a path");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Basstok URL must use HTTPS");
  }
  return url.origin;
}
