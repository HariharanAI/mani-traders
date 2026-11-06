import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <SearchX className="size-6" />
        </div>
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">The record may have been archived or the link is wrong.</p>
        <Link href="/" className="mt-5 inline-block text-sm font-medium text-brand hover:underline">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
