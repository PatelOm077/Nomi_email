import { createHash, timingSafeEqual } from "node:crypto";
import { createCookie } from "react-router";

function secret() {
  const value = process.env.NOMI_SUPPORT_ADMIN_SECRET;
  return value && value.length >= 32 ? value : null;
}
function cookie() {
  return createCookie("nomi_support_operator", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/support-inbox",
    maxAge: 8 * 3600,
    secrets: [secret() ?? "disabled"],
  });
}
export async function isOperator(request: Request) {
  if (!secret()) return false;
  try {
    const value = await cookie().parse(request.headers.get("cookie"));
    return typeof value?.expires === "number" && value.expires > Date.now();
  } catch {
    return false;
  }
}
export function validOperatorPassword(value: string) {
  const expected = secret();
  if (!expected) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(value), digest(expected));
}
export function operatorCookie(logout = false) {
  return cookie().serialize(
    { expires: logout ? 0 : Date.now() + 8 * 3600_000 },
    logout ? { maxAge: 0 } : {},
  );
}
export function operatorConfigured() {
  return Boolean(secret());
}
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
