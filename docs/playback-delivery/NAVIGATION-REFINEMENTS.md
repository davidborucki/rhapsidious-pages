# Navigation and playback refinement — October 4, 2026

Owner More controls appear only in the signed-in owner’s profile viewer. They are absent from Soundbytes and Saved. Repost attribution is text; a dismissible popup resolves exact public usernames before linking the avatar/bold name to their profiles. Untrusted names remain escaped text. Mobile web hides the volume slider and retains the mute control required for browser sound permissions.

`feed.prepareWindow: true` expands the existing preparation path to two adjacent clips in either direction, including when entering a profile or Saved library in the middle. Requests remain serial, current playback must be healthy, and only five player elements are retained. Ready idle buffers can remain while the next neighbor is prepared. Source identity is preserved on promotion/back navigation within that window. Offline, Save-Data, slow connections, backgrounding, stalled current playback, failed/expired media, timeout, and native download overrun protections remain. Set `prepareWindow: false` for the previous one-neighbor policy, or `prepareNextClip: false` to disable preparation entirely.

Native preload hints cannot guarantee how many bytes a browser transfers or instantaneous playback on a physical phone. Local real-media tests demonstrate prepared data and retained player reuse; they are not production cellular benchmarks.

Verification:
- 53 Node tests, including two-direction admission, serial preparation, retained identity, and cancellation.
- Profile interaction browser suite: desktop/mobile geometry, repeated wheel/swipe gestures, report flows, action order, and focus.
- Chromium and WebKit navigation-refinement suites: More context, escaped repost name, avatar/name links and outside dismissal.
- Chromium and WebKit real-media neighbor suites: own profile, another profile, Saved; five buffered elements, one playing, forward/back reuse.
- Full Chromium playback regression, including a separately configured one-neighbor rollback phase, real throttled transfers, interruption/cancellation, media reuse, mute/autoplay and legacy/queue boundaries.
