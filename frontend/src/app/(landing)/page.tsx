import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import LandingContent from "./LandingContent";

export default function LandingPage() {
  if (!isSupabaseConfigured()) {
    redirect("/dashboard");
  }
  return <LandingContent />;
}
