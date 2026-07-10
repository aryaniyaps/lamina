import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-teal-950 text-teal-50">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-display text-2xl font-bold">HavenStay</p>
          <p className="mt-3 max-w-sm text-sm text-teal-100/80">
            Discover exceptional stays with transparent pricing, trusted reviews, and seamless booking from search to checkout.
          </p>
        </div>
        <div>
          <h3 className="font-semibold">Travelers</h3>
          <ul className="mt-3 space-y-2 text-sm text-teal-100/80">
            <li><Link href="/search" className="hover:text-white">Search hotels</Link></li>
            <li><Link href="/trips" className="hover:text-white">Your trips</Link></li>
            <li><Link href="/help" className="hover:text-white">Help center</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">Partners</h3>
          <ul className="mt-3 space-y-2 text-sm text-teal-100/80">
            <li><Link href="/partner" className="hover:text-white">Partner portal</Link></li>
            <li><Link href="/policies/cancellation" className="hover:text-white">Cancellation policy</Link></li>
            <li><Link href="/policies/terms" className="hover:text-white">Terms of service</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-teal-800 px-4 py-4 text-center text-xs text-teal-200/60 sm:px-6">
        © {new Date().getFullYear()} HavenStay. All rights reserved.
      </div>
    </footer>
  );
}
