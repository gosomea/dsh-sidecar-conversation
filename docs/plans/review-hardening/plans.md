# Sidecar review hardening

## Background

The pre-release review found four release-blocking boundaries: an unsafe
permission fallback, an incomplete browser trust fence, content-derived
idempotency keys, and a one-page transcript loader.

## Main line

1. Make access selection explicit at both the type and runtime boundaries.
2. Fence every custom HTTP route to loopback authorities and same-site browser requests.
3. Give every new draft an opaque request identity that survives retries only.
4. Page history backwards until the first Sidecar prompt is present.
5. Keep the larger UI/runtime convergence work separate from this correctness patch.

