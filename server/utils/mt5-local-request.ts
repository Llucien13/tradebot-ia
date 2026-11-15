import { createError, getRequestIP, getRequestURL } from "nitro/h3";

export function assertLocalMT5Request(event: Parameters<typeof getRequestIP>[0]) {
  const url = getRequestURL(event, { xForwardedHost: false, xForwardedProto: false });
  const ip = getRequestIP(event, { xForwardedFor: false });
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) || (ip && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip))) {
    throw createError({ statusCode: 403, statusMessage: "Le pont MT5 est réservé à votre serveur local sur ce PC. Aucun accès distant au terminal n’est autorisé." });
  }
  const origin = event.req.headers.get("origin");
  const site = event.req.headers.get("sec-fetch-site");
  if ((origin && origin !== url.origin) || site === "cross-site") throw createError({ statusCode: 403, statusMessage: "Origine externe refusée pour le pont MT5 local." });
  if (!event.req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw createError({ statusCode: 415, statusMessage: "Requête JSON locale requise." });
}
