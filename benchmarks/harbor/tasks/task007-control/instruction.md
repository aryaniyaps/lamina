# Wishlist Feature

Design and implement a wishlist on the Vercel Commerce storefront for guests and registered shoppers.

## Requirements

- Add/remove products from wishlist while browsing; view wishlist; move items to cart (single or bulk)
- Guest wishlist persists across the session and merges into the account wishlist on login
- Share wishlist via link with optional privacy; support gift-buyer browsing
- Out-of-stock items are not purchasable from wishlist; show price at add-time; notify on material price changes
- Handle discontinued products, expired guest sessions, empty wishlist, and duplicate-add idempotency
- Accessible wishlist controls and bulk-action feedback

## Deliverable

A coherent, buildable **complete feature** implementation that fits the existing product: domain model, primary workflows end-to-end, edge/recovery paths, and UI that matches the host app patterns. Do not stop at a stub or single-path demo.

## Context

## Business goals
Increase return visits and conversion by letting shoppers save products without committing to cart.

## Users
- Guest shoppers saving items before account creation
- Registered users managing a persistent wishlist
- Gift buyers shopping from a shared list

## Constraints
- Brownfield Next.js Commerce storefront — fit product listing, PDP, cart, and checkout
- Guest persistence vs privacy; price notifications vs notification noise
- Existing flows to extend: product listing, product detail, cart, checkout
