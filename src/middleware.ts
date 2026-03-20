import { clerkMiddleware } from "@clerk/nextjs/server";

// All pages are public — auth is enforced at the component level (upload page)
// and in API route handlers (write endpoints)
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
