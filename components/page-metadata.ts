import type { Metadata } from "next";
import { PAGES, type PageKey } from "./site-content";

// Each page's own title and description for search results, with the same
// words for link previews (Open Graph and a text-only card), and its own
// canonical address (made absolute by metadataBase in app/layout.tsx).
export function pageMetadata(key: PageKey): Metadata {
  const { path, title, description } = PAGES[key];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: "Basis", type: "website" },
    twitter: { card: "summary", title, description },
  };
}
