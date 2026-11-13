# Design scale

The values new screens and new rules pick from. They live as CSS variables in `app/globals.css`.
Colours and fonts are in the same place and are not repeated here.

| What | Variables | Use |
|---|---|---|
| Text | `--t-min` 16 · `--t-sm` 18 · `--t-md` 22 · `--t-lg` 28 · `--t-xl` 40 | `--t-min` is the floor on the kiosk (read at arm's length). Display headlines are sized per screen. |
| Corners | `--r-sm` 10 · `--r-md` 14 · `--r-lg` 18 · `--r-xl` 28 | steppers and small buttons · buttons and photos · bars and panels · cards and sheets |
| Spacing | `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 18 · `--sp-5` 30 | gaps and padding |
| Touch | `--press` 0.97 · `--press-big` 0.985 | how far a button sinks while pressed; wide bars use the smaller move |
| Motion | `--fast` 0.09 s · `--move` 0.28 s · `--ease` | answer to a touch · something arriving or changing |

Rules:

- No kiosk text under 16 px. The only exceptions are the logo's own tagline and the test-mode corner tag.
  `tests/e2e/order-flow.spec.ts` checks every kiosk screen for this.
- Every kiosk button answers the finger (one rule at the end of `app/kiosk/kiosk.css`); a screen may
  override it with its own `:active` rule.
- Motion respects `prefers-reduced-motion`.

Status: the variables are used by the text floor, touch feedback and motion rules. Older rules still carry
their own pixel values; move them to the variables when a screen is next touched, comparing against `main`
side by side as `CLAUDE.md` asks.
