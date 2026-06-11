import { redirect } from "next/navigation";

// The proxy routes signed-in users to /portal or /dashboard;
// anyone who lands here is sent to login.
export default function Home() {
  redirect("/login");
}
