text
1. Performance & Infrastructure Optimization
- Implement strict separation of user data in all dashboard queries.
- Optimize database indexes and queries for high performance.
- Implement comprehensive event tracking (ViewContent, AddToCart, InitiateCheckout, Purchase, Lead, PageView).
- Ensure 100% responsiveness across all requested viewports (320px to 1920px).

2. Rebranding & UI/UX Elevation (Human Engineering)
- Deep scan and removal of "DarkPay" references.
- Visual refinement of the "PaymentBlack" identity (Premium Fintech look).
- Redesign notification icons and toasts to match the premium "P" branding.
- Polish spacings, typography, and component layouts to eliminate "AI-generated" feel.

3. New Dashboard Modules
- Implement "Intelligence Center" (📊 Metrics: Revenue, Profit, CPM, CPC, CTR, CPA, ROAS, Average Ticket, Conversion Rate, RPC, RPV).
- Implement "Conversion Funnel" (🎯 Funnel stages: Visitors -> Product View -> Checkout -> Payment -> Purchase).
- Implement "Live Sessions" (🔴 Real-time visitors: source, device, page, time).
- Implement "Traffic Origins" visualization (Facebook, Instagram, WhatsApp, Google, TikTok, Direct, Organic, Affiliates).
- Implement "Smart Alerts" system (Alerts for low CTR, slow checkout, high CPA, etc.).
- Implement "AI Marketing Assistant" interface for recommendations and bottleneck detection.

4. Checkout Ultra Optimization
- Audit and refine checkout load times (< 1s target).
- Implement progress indicators and lazy loading for heavy assets.
- Ensure cross-device stability and prevent memory leaks.

Technical Details:
- Frontend: React (TanStack Router + Query), Tailwind CSS, Lucide icons.
- Analytics: Use the existing `traffic_events` table for granular tracking.
- Security: Review RLS policies to ensure user data isolation.
- State: Local and session storage for performance cache.
