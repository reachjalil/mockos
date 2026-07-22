const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname);

const hasTrustedPublicProtocol = (url: URL): boolean =>
  url.protocol === "https:" ||
  (url.protocol === "http:" && isLoopbackHostname(url.hostname));

export const trustedPublicUrl = (
  value: string,
  label: string,
  options: { readonly pathSuffix?: string; readonly protocol?: string } = {}
): string => {
  const url = new URL(value);
  if (
    !hasTrustedPublicProtocol(url) ||
    (options.protocol !== undefined && url.protocol !== options.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be a trusted HTTPS or loopback URL.`);
  }
  const normalized = url.toString().replace(/\/$/, "");
  if (
    options.pathSuffix &&
    !new URL(normalized).pathname.endsWith(options.pathSuffix)
  ) {
    throw new Error(`${label} must end in ${options.pathSuffix}.`);
  }
  return normalized;
};
