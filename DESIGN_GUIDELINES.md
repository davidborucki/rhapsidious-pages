# Voxxly design guidelines

Shared design direction for the mobile and web frontends. Keep this file consistent in both repositories. Use it when building or revising screens; older screens with conflicting styles are not the reference.

## Direction

Build calm, clean pages with useful controls and very little explanatory text. The recent profile, upload, sign-in, and analytics designs are the reference: a dark canvas, clear typography, simple alignment, and restrained orange accents.

- Start with the page background. Do not put every section inside a card.
- Organize with spacing, alignment, and type hierarchy. Add a subtle divider only when it helps.
- Use solid colors. No decorative gradients, glows, avatar rings, or ornamental borders.
- Reserve distinct surfaces for controls, menus, dialogs, and groups that actually need separation.
- Keep the primary action obvious. Avoid competing emphasis and unnecessary buttons.
- Reuse shared components and tokens instead of making slightly different versions for each screen.

## Color and type

The approved web palette is the shared visual reference. Adapt it through native theme tokens on mobile; these values do not imply every legacy native screen already matches.

| Role | Reference |
| --- | --- |
| Page background | `#07070d` |
| Subtle surface | `#12111b` |
| Control surface / default avatar | `#181622` |
| Main text | `#fbfaf8` |
| Secondary text | `#aaa5b2` |
| Subtle divider | White at 10% opacity |
| Primary accent | `#ff8200` |

- Use orange for primary actions, selected navigation, and relevant chart emphasis. Do not color creator names orange just because they are links.
- Use a faint, flat orange background for a notice needing attention, such as email verification. Keep the message short.
- Use readable sans-serif type and a small, consistent hierarchy. Use platform text styles on mobile and support text scaling.
- Let titles wrap when necessary. Do not shrink important text to fit long names.
- Keep rounded controls consistent. Rounded corners are not a reason to add a card around content.

## Copy

Use the fewest words that make the action or state clear. Avoid promotional taglines, repeated headings, obvious instructions, and paragraphs explaining an empty screen.

| Situation | Preferred copy |
| --- | --- |
| No profile posts | No posts yet |
| No profile reposts | No reposts yet |
| Nothing saved | No saved clips yet |
| Profile link copied | Copied to clipboard |
| Report submitted successfully | Report sent |
| Email verification needed | Confirm your email to upload |
| Analytics settings entry | View analytics |

Keep errors specific and actionable. Put genuinely useful secondary explanations behind an optional disclosure instead of displaying them all at once. Never add a line like “One tap to unlock uploads” beneath an already clear action.

## Shared patterns

### Empty states and brief banners

- Empty states are centered text directly on the page background. No colored panel, border, extra paragraph, or unnecessary button.
- Temporary banners stay low, above navigation and the safe area, and are horizontally centered by layout.
- Size banners to their content with modest, even padding. Do not stretch a short message across the screen.
- Limit width to the available viewport and allow long messages to wrap. Keep the text centered and the banner clear of essential controls.
- Use the same banner treatment for copy, follow, report, and other short success feedback. Show success only after the action succeeds.

### Profiles and account lists

- Use a borderless circular avatar. Default avatars use the same solid muted background and initial treatment everywhere, including the web header beside Log out.
- Place the avatar before the name and handle. Keep stats in this order: **Posts, Followers, Following**.
- Own profile actions: **Edit profile** and **Settings**.
- Other profile actions: **Follow / Following**, **Share**, then an icon-only circular report button on the same row. Match its height to the neighboring buttons.
- Put icons before button text. Do not add another plus button or a report action on the owner's profile.
- Share copies the profile link and shows the compact confirmation banner.
- Email verification is visible only to the owner and disappears after confirmation.
- Account lists do not need trailing arrows. Keep return navigation simple, without “Back to @…” arrow decoration.

### Native navigation

- The Voxxly/avatar/Log out header is web-only. Do not add it to signed-in iOS screens.
- iOS uses a flat bottom bar anchored to the bottom safe area, without a floating card: **Soundbytes, Search, Upload, Profile**. Saved clips are under **Profile → Settings → Saved clips**.
- Profile and Saved videos push from the right and return to their source page on a rightward swipe. Do not present these viewers as bottom sheets.
- Animate Posts/Reposts selection and respect Reduce Motion. Tapping blank Search space dismisses the keyboard without interfering with profile links.

### Settings

- Give ordinary rows equal visual weight; Manage account should not look selected by default.
- Put **View analytics** in the profile's Settings, not as an extra action on the profile itself.
- On web, Contact support, Privacy policy, and Terms of service open their destination pages directly in a new tab. Do not add intermediary explanatory pages.

### Video controls

- Keep the same right-hand vertical interaction stack across feed, profile, and saved viewers.
- Order: Watch when available, Profile, Like, Save, Repost, then Report for another user's clip. **More** appears for owned clips only when viewing the signed-in user's profile; never on Soundbytes or Saved.
- Use white icons by default. Selected Like is `#ff453a`, Save `#f47604`, and Repost `#ffc107`, including labels. Watch uses the shared red/yellow popcorn artwork. More uses three dots.
- On web, align close and mute controls with symmetric insets. Native iOS uses system volume and has no on-screen volume changer.
- Repost attribution is text without a people icon. Open a small dismissible popup with the reposter's avatar, bold name, and “reposted this soundbyte”; avatar/name link to their profile.
- Keep controls visible and anchored correctly through swipes, loading, transitions, and browser viewport changes.
- Navigate profile videos with vertical touch and trackpad gestures, without previous/next arrow buttons. Handle momentum without blocking the next deliberate gesture.
- Open report dialogs with the reason picker closed; the user chooses when to open it.
- Avoid a leftover orange outline after pointer interactions or canceling a dialog. Preserve a clear keyboard focus indicator.

### Forms, upload, and onboarding

- Show what the user needs now. Split longer flows into focused steps when that reduces clutter.
- Prefer one clear primary action per step, compact fields, and short labels.
- Reveal optional or advanced controls when needed instead of presenting everything at once.
- Keep validation beside the relevant field and preserve entered data on errors.
- Do not wrap every field or instruction in a separate card.

### Analytics

- Lead with useful numbers, then charts and detail. Use short labels, restrained dividers, and orange chart accents without gradients.
- Keep timeframes easy to scan: **7D**, **1M**, **3M**, **All time**.
- Support both profile performance and individual clips without crowding the overview.
- Show unavailable rates as an em dash, not a misleading zero. Do not invent historical data.
- Keep metric definitions and limitations in an optional “About these numbers” disclosure.

## Platform behavior and review

Translate the same design into each platform's existing components; do not force web mechanics onto native mobile. Maintain comfortable touch targets (at least 44 points on iOS and approximately 44 CSS pixels on web), safe-area spacing, accessible names for icon buttons, readable contrast, and visible keyboard focus.

Before shipping a screen:

- Inspect the rendered phone layout and relevant desktop layouts, including long names and larger text.
- Check loading, empty, error, success, disabled, and signed-out states as applicable.
- Verify touch, trackpad, and keyboard behavior where supported. Respect reduced-motion preferences.
- Check that banners fit their text, controls stay stable during transitions, and bottom navigation does not cover content.
- Remove any decorative surface, sentence, icon, or border that adds no useful information.
- Verify the real action works; visual polish includes correct navigation, persisted changes, and honest feedback.
