# Stage 10: farmer communication

Status: partly built (dashboard, claim tracking, transparent explanation, challenges). Not built: notifications.

## What exists
- `GET /api/my/claims`, `GET /api/my/claims/{id}` (`backend/app/api/my_claims.py`): farmer-only, scoped to the farmer's own policies
  (anything else returns 404). Plain language, no internal user ids.
- `backend/app/services/farmer_view.py`: restates what the claim engine stored: measured rain ± uncertainty, policy trigger/full level,
  the severity and amount working (prior payments, caps), this farm's slice of the agent run (gauges used/left out, safety checks),
  who decided and why, the payment, and a step-by-step timeline.
- Farmer dashboard (`/farmer`): to-do alerts (no farm / policy / bank account), active claims with a 5-step tracker, paid so far,
  policies, payout account. `/farmer/claims` lists all claims; `/farmer/claims/:id` is the "why this amount" page with a rain bar.
- Simulated storms are labelled as such on every claim.
- Fix: agent-queued claims now record `farmer_profile_id`, and payment resolves the farmer through the policy for older claims.

## Challenging a claim
- Farmer: `POST /api/my/claims/{id}/challenge` (category + reason of 10+ characters) on a REJECTED, APPROVED or PAID claim.
  One open challenge at a time, at most two per claim. The claim moves to DISPUTED.
- Insurer: `POST /api/claims/{id}/dispute/resolve` (`uphold` / `dismiss` + note, optional amount). The plain decision endpoint
  refuses DISPUTED claims.
- Money stays consistent: a disputed claim counts as its previous status for policy caps, reconciliation and stats.
  Dismiss restores that status. Uphold on an unpaid claim returns it to AWAITING_APPROVAL (optionally with a corrected amount);
  uphold on a PAID claim never repays: the extra amount becomes a separate supplementary claim that needs approval and payment,
  and cannot exceed the policy cap.
- Rules: `backend/app/services/disputes.py`; tests: `backend/tests/test_disputes.py`.

## Languages (English, Hindi, Marathi)
- Language switcher in the farmer navbar (saved in the browser). Applies to the farmer dashboard, claims list, claim page and the challenge form.
- Screen text: typed dictionaries in `frontend/src/i18n/{en,hi,mr}.ts` (a missing Hindi/Marathi key fails the build). `en.ts` is the source.
  Hindi and Marathi are drafts and should be reviewed by a native speaker before production use.
- The "why this amount" explanation is not translated text: the backend sends keys plus the engine's raw numbers
  (`row.key` / `vkey` / `vars`) and the frontend fills a translated template, so no number ever depends on a translator.
- Free text (the automated review summary, the insurer's decision note and challenge answers) is machine-translated by Gemini
  on request (`?lang=hi|mr`). Digits are normalised to 0-9, any number not in the original text rejects the translation,
  and on failure the English original is shown.
- Not yet translated: farm registration, policy, bank and profile pages, the insurer screens, notifications.

## Not done
- SMS / WhatsApp / email notifications (including "your challenge was answered").
- Photo or document evidence on a challenge.
- A challenge for "a storm hit me but no claim was created".
- Local-language text.
