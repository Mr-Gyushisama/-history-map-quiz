# BALLNOTE Real-Device Acceptance v0.3

Target:
- iPhone Safari / PWA
- iPad Safari / PWA
- development branch: ballnote-scorebook-v030

MVP release gate:
> With network connectivity disabled, one complete game can be started, scored, interrupted by app restart, resumed, corrected, and finished without losing or corrupting game state.

## A. Install / offline readiness

1. Open BALLNOTE once while online.
2. Confirm top status shows "オフライン準備済".
3. Close the app completely.
4. Enable airplane mode and disable Wi-Fi.
5. Launch BALLNOTE again.

PASS:
- App shell opens without network.
- Existing local game, if any, is visible.
- No blocking network error appears.

FAIL:
- Blank screen.
- Browser error page.
- Game cannot be resumed.

## B. Normal pitch input speed

Record at least 30 consecutive pitches using BALL / STRIKE / FOUL / SWING.

PASS:
- Each normal pitch requires one tap.
- Tap response is immediate enough to keep eyes on the field.
- No confirmation dialog.
- No network spinner or wait.
- Count updates correctly.
- Most recent input remains visible in the pinned lower bar.

## C. Undo / Redo

During LIVE:
1. Enter BALL.
2. Tap Undo once.
3. Tap Redo once.
4. Repeat after an in-play result.

PASS:
- Undo is always visible.
- One tap restores the exact previous count / bases / outs / score / batter state.
- Redo restores the reverted action.
- No menu navigation is required.

## D. Core multi-runner play

Create:
- 1 out
- runners on first and third

Record:
- shortstop ground ball
- runner from first out at second
- runner from third scores
- batter safe at first

Expected:
- play can be entered without waiting for communication
- outs become 2
- first base = batter
- second / third empty
- one run scores
- original first-base runner receives second-out marker Ⅱ
- scoring runner receives ● unless scorer override changes it
- BOX shows ground-ball symbol and fielding route
- one Undo returns the entire play atomically

## E. Next-pitch-first quick commit

For a complex play:
1. Set the immediate bases / outs / score.
2. Tap "状態だけ確定 → 次球".

PASS:
- Next pitch pad becomes available immediately.
- Play receives needsReview.
- LIVE and History show the pending-review count.
- BOX also shows unresolved-review warning.
- Later correction can update runner result / batting result / responsible fielder / throw path.
- Undo remains atomic.

## F. Correction / replay safety

Test at minimum:
- 6-3 -> 5-3 responsible-fielder correction
- OUT -> 1B batting-result correction
- runner out -> safe at next base
- scorer ● / ○ override
- RBI yes / no override

PASS:
- Correction shows replay preview before applying.
- A correction that breaks a later runner state is blocked.
- Accepted correction recalculates:
  - inning / half
  - outs
  - bases
  - score
  - batting order
  - BOX
  - batting stats
  - pitcher stats
  - fielding stats
- Undo returns the complete pre-correction state.

## G. Substitutions

Test:
- pinch hitter
- pinch runner
- defensive substitution
- position change
- pitching change
- multiple simultaneous defensive changes

PASS:
- batting order is preserved correctly
- inherited runner responsibility remains with the correct pitcher
- two-strike pinch-hitter strikeout is attributed under the confirmed BALLNOTE rule
- Undo / Redo keeps the substitution transaction atomic

## H. Special scoring

Test:
- HBP
- IBB
- WP
- PB
- balk
- dropped third strike by WP
- dropped third strike by PB
- dropped third strike by E with selected responsible fielder
- pickoff
- rundown
- appeal out
- runner interference
- obstruction
- batting interference

PASS:
- BOX notation remains symbolic / structured rather than flattened display text
- pitcher / fielding statistics update correctly
- scorer overrides remain available where judgment is required

## I. Restart recovery in the middle of a game

At approximately the 4th inning:
1. Confirm current inning / half / count / outs / bases / score.
2. Force-close BALLNOTE.
3. Keep airplane mode on.
4. Reopen.

PASS:
- Same gameId resumes.
- inning / half / count / outs / bases / score match.
- batting order position matches.
- scorecards / pitch history remain.
- Undo history for current local session behaves as designed; persistent game state itself must be correct.

## J. Complete offline game

Run one full 7-inning game and one full 9-inning game in airplane mode.

Include:
- at least one hit
- one walk or HBP
- one runner event
- one substitution
- one complex play
- one correction
- one restart

PASS:
- game finishes without connectivity
- regulation / extra-inning / walkoff behavior is correct
- no state loss
- BOX is complete for both teams
- Data screen is internally consistent
- completed game remains local
- sync status does NOT falsely claim server upload

## K. PDF / print

After game completion:
1. Open BOX.
2. Choose PDF / 印刷.

PASS:
- MY TEAM and opponent scorebooks are printable.
- screen-only controls do not appear in print.
- pending-review warning is not printed as scorebook content.

## L. Long-game stress

Record at least:
- 300 pitches
- 100 plate appearances equivalent stress data if practical

PASS:
- no blank screen
- no obvious progressive input slowdown
- no local save failure
- app restart still restores the game

Current synthetic reference:
- 54 PA / 162 pitches serialized game: about 229 KB
- 100 PA / 300 pitches serialized game: about 525 KB

## Release decision

Do not mark the zero-network MVP requirement complete until:
- iPhone test passes A-L
- iPad test passes A-L, or documented tablet-only UI exceptions are accepted
- latest automated regression workflow is green
- no unresolved critical scoring defect remains

Record test device, OS version, browser/PWA mode, date, result, and any defect ID.


## M. v0.3.1 mobile layout and destructive-action guard

Test on at least one notched / Dynamic Island iPhone in Safari and installed PWA mode.

PASS:
- Top header content does not overlap the iOS status bar.
- Bottom navigation and pinned Undo / Redo do not overlap the home indicator.
- Tapping first / second / third base in the LIVE diamond cannot directly mutate runner state.
- Manual game end opens a confirmation step before ending the game.
- LIVE uses 「申告敬遠」「ボーク」「空振り」 labels and opponent-name editing is not a primary live control.

## N. v0.3.1 BOX visual acceptance

Create examples containing:
- a hit followed by later advancement,
- WP advancement,
- a third out,
- a plate appearance with at least 10 recorded pitches,
- two plate appearances by the same batting-order slot in one inning.

PASS:
- hit path is red and later advancement is black,
- WP / responsible-batter labels do not collide with the primary fielding notation,
- the dedicated pitch strip keeps the complete visible pitch sequence,
- the third out has the two-slash change marker,
- repeat plate appearances expand horizontally under the same inning header,
- the batting-order column and inning header remain understandable while horizontally / vertically scrolling,
- 6- or 7-inning games do not pre-render unused inning columns on screen.
