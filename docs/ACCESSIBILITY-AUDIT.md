# Manual accessibility audit brief

What to give an auditor, and what not to waste their time on.

Automated rules already run on every push — `tests/e2e/accessibility.spec.ts`
covers the fifteen public pages, `accessibility-authenticated.spec.ts` covers
the twenty-two behind sign-in plus each step of the opportunity editor. Those
catch roughly a third of real defects: the mechanical third. Contrast ratios,
missing labels, invalid ARIA, heading structure, `<dl>` misuse. Do not pay
someone to re-check those.

This brief is the other two thirds — the things that need a person, ideally one
who uses assistive technology daily rather than one who has installed it for
the engagement.

---

## Scope, in priority order

Ordered by how much a failure costs the person hitting it, not by how likely
it is.

### 1. The seven-step opportunity editor (`/admin/opportunities/{id}`)

The hardest screen in the product and the one a researcher uses all day.

- Moving between steps: is the change announced? Where does focus land? A step
  change that leaves focus on the old "Next" button silently strands a screen
  reader user at the bottom of a page that is no longer there.
- Autosave fires every 1.5 seconds. Is it announced, and if so, does it
  interrupt? A polite live region that fires every keystroke is worse than
  silence.
- The publish gate lists missing fields and links to the step each lives on.
  Following one of those links: does focus land on the field, or on the step?
- Local draft recovery offers to restore. Is that offer reachable before the
  form, or does it appear after 60 fields?

### 2. Search, filter and results (`/opportunities`)

- Applying a filter updates results without a page load. Is the new result
  count announced? Is it announced _once_?
- Locked records show an upgrade prompt instead of the content. Does that read
  as "this record is locked and here is why", or as an unexplained gap?
- Cursor pagination: after "load more", where is focus? The first new result is
  usually right; the top of the page is always wrong.

### 3. The report builder (`/admin/reports/{id}`)

- Reordering entries is keyboard-accessible by design. Confirm it: can you
  reorder without a mouse, and is the new position announced?
- Per-section access ranks are a matrix of selects. Is the relationship between
  a row and its control clear when read linearly?

### 4. Forms that reject input

`/register`, `/support`, `/corrections/new`, `/account/preferences`.

- On a validation failure, is the error announced and is focus moved to the
  first bad field?
- Is the error text sufficient on its own? "Invalid" is not.
- The password field requires twelve characters. Is that stated before
  submission, not only after failure?

### 5. Score presentation

Scores are the product. A score band that only reads as a number loses the
interpretation that the subscription is paying for.

- Does a screen reader convey both the number _and_ the classification
  ("72 out of 100, Strong Opportunity")?
- Meters carry `role="meter"` and a text label. Confirm they are announced
  usefully rather than as a bare percentage.

---

## Conditions to test under

- **Screen readers:** NVDA with Firefox, VoiceOver with Safari, and at least
  one mobile pass with VoiceOver or TalkBack. The member area is used on
  phones — the deadline calendar especially.
- **Keyboard only**, no mouse, for a complete task: sign in, find a record,
  save it, set a deadline reminder.
- **200% zoom** and **400% zoom** at 1280px wide. Content must reflow, not
  scroll sideways.
- **Windows High Contrast Mode.** Custom focus rings often vanish.
- **Reduced motion** enabled. Automated tests confirm the site renders; a
  person should confirm nothing important is now invisible because it was
  conveyed by a transition.

---

## Known gaps — do not report these as findings

Recorded so the audit spends its time on things we do not already know.

1. **Attached source documents are frequently inaccessible.** They are scanned
   images from county websites with no text layer. We cannot fix a county's
   scan. The record's own fields carry the substance, and the accessibility
   statement commits to supplying anything on request in another format.
2. **Generated report PDFs are not tagged.** The same content is available as
   a web page, which is. Tagging the PDF writer is known work, not a discovery.
3. **`/pricing` and `/support` render per request** while other public pages
   are cached. A performance decision, not an accessibility one.

---

## What we want back

Findings with: the screen, the assistive technology and version, what you
expected, what happened, and the WCAG success criterion if one applies. Severity
in terms of whether the task can be completed at all, completed with
difficulty, or merely annoying.

A finding that says "the editor is hard to use with a screen reader" cannot be
acted on. One that says "on step 4, after the county select, focus jumps to the
page heading and the step number is not announced" can be fixed the same day.

We would rather hear that a task is impossible than that a label is imperfect.
