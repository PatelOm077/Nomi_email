import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { processPendingEmailJobs } from "../email-delivery/process-jobs.server";

function authorized(request: Request): boolean {
  const secret = process.env.EMAIL_JOB_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const result = await processPendingEmailJobs();
  return Response.json(result);
};
