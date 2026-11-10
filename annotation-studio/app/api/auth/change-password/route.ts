export const dynamic = "force-dynamic";

// Keep old clients from changing credentials after the self-service page is
// removed. Only administrator account controls may reset annotator passwords.
export async function POST() {
  return Response.json({ error: "Passwords are managed by an administrator.", code: "PASSWORD_CHANGE_DISABLED" }, {
    status: 403,
    headers: { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" },
  });
}
