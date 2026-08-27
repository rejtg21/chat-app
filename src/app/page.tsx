import { DocumentChat } from "@/components/DocumentChat";

/**
 * The app is a single screen with several states.
 *
 * State is read from the database on the client rather than server-rendered,
 * so the page still renders — and can explain itself — when DATABASE_URL is
 * missing or the migration has not been run yet. A server fetch here would
 * turn a setup mistake into a build-time or render-time crash.
 */
export default function Page() {
  return <DocumentChat />;
}
