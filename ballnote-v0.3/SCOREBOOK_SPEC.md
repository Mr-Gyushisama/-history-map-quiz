# BALLNOTE Scorebook Specification v1

## 1. Purpose
BALLNOTEの「BOX」は単なる得点集計表ではなく、試合を打席単位で再現できる早稲田式スコアブックを指す。

## 2. Source policy
- 基本様式: 早稲田式
- Visco mobile公式ガイドのスコアカード構成を基準にする
- 打球種別の図形表現は、確認できた早稲田式記号を優先する
- 流儀差がある記号は内部データと表示を分離し、後から表示方式を切替可能にする

## 3. Scorecard cell zones
1. 打撃結果・一塁への走塁結果
2. 二塁への走塁結果
3. 三塁への走塁結果
4. 本塁への走塁結果
5. 中央: 最終結果
6. 左側/カウント欄: 投球経過・交代タイミング

## 4. Confirmed symbols
### Batted-ball shape
- Ground ball: ◡
- Fly ball: ◠
- Line drive: ―
- Other batted-ball types are stored as structured data and rendered using the configured score-symbol set.

### Defensive route
- Fielder numbers: 1-9
- Example: third baseman to first baseman = 5-3
- Error example: 6-4E

### Final result
- First out: Ⅰ
- Second out: Ⅱ
- Third out: Ⅲ
- Run / earned: ●
- Run / unearned: ○
- Left on base: ℓ

### Pitch marks (current BALLNOTE default)
- Ball: ●
- Called strike: ◎
- Swinging strike: ○
- Foul: －
These are configurable display symbols; raw pitch result remains canonical.

## 5. Examples
### Groundout
Internal:
- battedBallType = ground
- fieldedBy = 5
- throwPath = [5,3]
- batterResult = out
- outNumber = 3

Display:
- ◡ above 5
- 5-3
- center = Ⅲ

### Flyout
Internal:
- battedBallType = fly
- fieldedBy = 8
- batterResult = out
- outNumber = 2

Display:
- ◠ above 8
- center = Ⅱ

### Lineout
Internal:
- battedBallType = line
- fieldedBy = 6
- batterResult = out

Display:
- ― above 6

## 6. Runner advancement
A scorecard is not complete when the plate appearance ends. It remains the runner's scorecard until that runner is retired, scores, or is left on base.

A scorecard must preserve:
- origin base
- destination base
- event causing advancement
- responsible batter/order when advancement was caused by batting
- RBI attribution
- out/score/left-on-base final state
- later runner-only events that occur during a following batter's plate appearance

Runner-only events are attached to the original runner scorecard rather than creating a fake new plate appearance.

For advancement caused by batting:
- normal advancement is rendered with the responsible batter's order as (1) to (9)
- when RBI is credited, the batter order is rendered as ① to ⑨
- the responsible batter order and RBI flag remain structured data, not hard-coded score text

Current runner-only reasons:
- stolen_base => SB
- caught_stealing => CS
- wild_pitch => WP
- passed_ball => PB
- fielder_choice => FC
- error => E

The rendered scorebook must draw advancement on the central diamond and place the reason on the relevant advancement segment where practical.

## 7. Substitutions
Store substitutions as events and preserve appearance history even when the active lineup slot changes.

Current implementation:
- pinch hitter
- pinch runner
- substitution timing stores inning + ball/strike count
- pinch hitter substitution is written into the scorecard count area
- pinch runner continues the original runner scorecard through activeRunnerId while run/SB/CS stats belong to the substitute runner
- batting-order display groups starter and substitutes under the same order
- Undo/Redo restores lineup, bases, bench, appearance history, scorecard markers, and substitution events

Mid-count batting attribution:
- when a batter is replaced after two strikes and the substitute strikes out, strikeout + AB are charged to the player who was batting when two strikes had been reached
- if the substitute completes the PA with a non-strikeout result, the result belongs to the substitute
- strikeoutOwnerId is reset at the end of the PA

Current defensive implementation:
- defensive substitution while MY TEAM is fielding
- position change, including automatic position swap when the destination position is occupied
- pitching change when P is replaced or a player moves into P
- defensiveStint and pitchingStint event history
- defensive changes are written into the active opponent scorecard timing area using the defensive color channel
- same-timing consecutive substitutions share batchId
- the first change in a batch creates the Undo snapshot; subsequent changes in the same timing batch do not
- Undo once restores the complete simultaneous substitution batch, and Redo once restores the batch

Current opponent-roster / substitution implementation:
- opponent starts with nine placeholder starters and nine placeholder bench players
- opponent names can be edited after game start without blocking scoring
- PH / PR routing uses the currently attacking team, so either team can substitute offensively
- defensive substitution / position change routing uses the currently fielding team, so either team can substitute defensively
- appearance history, bench movement, substitution events, batchId, and scorecard timing are kept per team
- dual-team substitution routing has a focused logic test

Pitching aggregation now implemented:
- per-pitcher pitches
- batters faced
- hits allowed
- walks
- strikeouts
- pitching outs with baseball IP notation
- runs (R), earned runs (ER), and wild pitches (WP)
- pitcher identity follows the active defensive P position
- when the pitcher is not registered, stats are retained under an explicit unknown-pitcher bucket rather than guessed
- each scorecard that creates a runner stores responsiblePitcherId / responsiblePitcherTeam
- pinch running does not change pitcher responsibility because the original runner scorecard remains canonical
- inherited runners that later score are charged to the original responsible pitcher
- a fielder's-choice out of an inherited runner can transfer the predecessor-pitcher liability to a surviving runner, preserving the predecessor's responsibility count
- if multiple predecessor liabilities make the transfer ambiguous, the Play is flagged needsScorerReview rather than silently inventing certainty
- mid-plate-appearance pitching changes preserve walk responsibility for 2-0, 2-1, 3-0, 3-1, and 3-2 counts
- at those counts, a later walk is charged to the predecessor; a non-walk result is charged to the reliever
- Undo / Redo restores score, bases, pitcher R/ER, and responsibility assignments atomically

Fielding aggregation now implemented from structured play data:
- PO from the fielder who completes each recorded out
- A from the structured throw path, with at most one assist per fielder in the same play
- E from explicit error result + responsible fielder
- DP participation for fielders involved in a recorded multi-out play
- fielding percentage = (PO + A) / (PO + A + E)
- normal strikeout credits the catcher with the rules-based putout

Still required:
- full 9.16 virtual-inning reconstruction for every multi-error / multi-reliever edge case
- explicit scorer UI to resolve a needsScorerReview pitcher-responsibility transfer
- scorer override for ambiguous fielding sequences, rundowns, interference, appeals, and post-error secondary plays

## 8. Full-game half-inning state
The canonical live state now distinguishes:
- inning number
- half = top / bottom
- offenseKey = self / opponent derived from self side and half
- independent batting indexes for self and opponent
- independent team scores and inning scores
- independent defensive pitching aggregates
- self lineup and placeholder opponent lineup

Three outs transitions:
- top -> bottom of the same inning
- bottom -> top of the next inning
- remaining runners receive ℓ before bases are cleared
- count and current pitch sequence are cleared

BOX and Data can switch between MY TEAM and opponent. Opponent players may remain placeholders until names are supplied later.

## 9. Data model
Canonical data is structured, not the rendered notation.
Score notation is generated from:
- Pitch[]
- PlateAppearance
- BattedBall
- FieldingAction[]
- RunnerAction[]
- SubstitutionEvent[]
- FinalResult

## 10. Strikeout / dropped third strike
Strikeout display and structured data are separated:
- called strikeout => K
- swinging strikeout => reversed K
- strikeoutType is canonical and the symbol is rendered from it

An uncaught third strike is recorded as a strikeout even when the batter reaches first.
The batter may become a runner when:
- first base is unoccupied; or
- there are two outs.

Cause is stored independently:
- wild_pitch
- passed_ball
- error

The same Play may also contain RunnerAction records for existing runners.

## 11. Sacrifice / double play
Current scoring rules:
- SH: before two outs, at least one runner advances, batter is recorded out in the current MVP path, PA increments, AB does not
- SF: before two outs, at least one runner scores, batter is out, PA increments, AB does not
- GDP: at least two outs in the same continuous Play, PA and AB increment

Scorer judgment remains authoritative for borderline sacrifice/error/FC cases. Future scorer override will support sacrifice credit where the batter reaches because of an error or unsuccessful play on another runner.

## 12. Undo / correction
All live operations must be reversible immediately.
A correction recomputes:
- count
- outs
- bases
- score
- batting order
- scorecard
- batting stats
- pitching stats

## 13. v0.3 implementation scope
Implemented in prototype branch:
- pitch marks retained per PA
- ground/fly/liner symbols
- fielder/throw path
- out number Ⅰ/Ⅱ/Ⅲ
- hit path on diamond
- inning x batting-order scorebook matrix
- score line summary
- Runner Resolution UI for plays with existing runners
- structured Play + RunnerAction[] history
- batter-runner and existing runners resolved independently
- per-runner safe / out / destination / out base / receiving fielder
- scored runner earned/unearned marker selection (● / ○)
- RBI scorer override
- prior runner scorecard updated with advancement, out number, or run marker
- one-step Undo/Redo restores the whole game snapshot including bases, score, outs, stats, Play history, and BOX state

Verified scenario:
- start: 1 out, runners on first and third
- play: shortstop ground ball
- runner from first: out at second on 6-4
- runner from third: scores
- batter-runner: safe at first
- expected result: 2 outs, +1 run, batter on first, first-base runner marked Ⅱ, third-base runner marked ●
- Undo restores the exact pre-play state

Added after reference-scorebook review:
- scorecard lifecycle continues after the plate appearance while the player remains a runner
- runner-only event log stored separately from the active batter's plate appearance
- SB / CS / WP / PB quick entry from LIVE
- SB / CS / WP / PB written back to the original runner scorecard
- third-out processing marks all remaining runners with ℓ
- walk force advances now use structured RunnerAction records rather than direct base mutation
- runner-event Undo/Redo uses the same full-game snapshot path
- batting-caused advancement stores responsibleBatterOrder
- BOX renders normal advancement as (n) and RBI advancement as circled ①-⑨
- sacrifice bunt (SH) and sacrifice fly (SF) use dedicated batting results
- SH / SF are excluded from AB while remaining plate appearances
- sacrifice validation prevents two-out sacrifices and requires the relevant runner advance / run
- grounded-into-double-play (GDP) stores two or more outs in the same Play and counts as AB
- inning-ending GDP validation prevents a run from being counted when the batter-runner is the third out
- called strikeout renders as K
- swinging strikeout renders as reversed K
- uncaught third strike / dropped-third-strike flow stores strike type separately from WP / PB / E cause
- dropped-third eligibility follows the rule: batter may become a runner when first base is unoccupied or when there are two outs
- called or swinging third strike may both enter the dropped-third flow
- legacy local game stats are migrated with SH / SF / GDP / SB / CS fields on load
- pinch hitter and pinch runner events are stored with inning/count timing
- scorebook batting-order rows preserve starter + substitute history
- pinch-runner identity is separated from the original hitter's scorecard ownership
- two-strike pinch-hit strikeout attribution follows the scoring rule by retaining the strikeout owner
- explicit top / bottom half-inning state
- self/opponent offense is derived from side + half instead of assuming MY TEAM is always batting
- opponent placeholder lineup and independent opponent batting order
- separate self/opponent score and inning-score arrays
- BOX and Data can switch between self and opponent
- defensive substitution, position change, and pitching-change events while MY TEAM fields
- defensive and pitching stint histories
- simultaneous substitution timing groups use a shared batchId and one-step Undo/Redo
- opponent roster names are editable after start while placeholders remain valid
- opponent bench placeholders support later PH / PR / defense changes
- substitution routing now works for either offense or defense team

Additional official-scoring coverage now implemented:
- HBP / dead ball (DB) as a one-tap plate-appearance result
- bases-loaded HBP credits the forced run and RBI while excluding the PA from AB
- intentional walk (IBB) as a no-pitch plate-appearance result, tracked inside BB and separately as IBB
- balk (BK) as a runner-only event and pitcher statistic
- passed ball (PB) as a runner-only event and catcher fielding statistic
- batting-interference reach (妨出) as a PA without AB, with responsible fielder error
- forced run on batting interference can credit RBI
- error / batting interference / obstruction / passed-ball paths default the affected runner to non-earned-run eligibility
- scorer can still override responsible pitcher and earned/unearned result through the correction UI
- rare runner events are routed through a separate runner-special flow so common LIVE entry remains fast
- runner-special reasons currently include pickoff, rundown, appeal out, runner interference, and obstruction
- runner events preserve outType and optional explicit fieldingPath
- rundown / appeal fielding path aggregates unique assists and final putout without flattening the event to a display string
- post-error secondary outs are stored as multiple FieldingAction records inside one Play
- HBP / IBB batter scorecards preserve the home-to-first advancement path

Derived analytics now implemented:
- team R / H / E
- batting 1B / 2B / 3B / HR / TB
- AVG
- OBP = (H + BB + HBP) / (AB + BB + HBP + SF)
- SLG
- OPS
- pitcher ERA shown explicitly as 9-inning equivalent = ER x 27 / OUTS
- WHIP = (H + BB) x 3 / OUTS
- batting interference reach is excluded from the OBP numerator and denominator
- youth-game inning length is not silently substituted into ERA; the display says 9-inning equivalent

Raw pitch / persistence / output now implemented:
- Game receives a device-generated gameId
- Pitch[] is canonical raw pitch data with global sequence, inning/half, offense/defense team, batter, pitcher, pitch result, count before/after, outs and bases context
- scorecards store pitchIds and render pitch marks from Pitch[]; legacy display marks remain only as compatibility fallback
- strikeout / walk / in-play / dropped-third / HBP flows connect to structured Play records
- HBP is a one-tap terminal pitch event and stores raw result = hit_by_pitch
- declared intentional walk is a one-tap no-pitch plate-appearance event; BB and IBB are both aggregated
- balk is a RunnerEvent and defaults all occupied runners to one-base advancement
- pickoff is a RunnerEvent with the runner's current base as the out base and a structured default 1-to-receiver fielding path
- passed ball is aggregated to the catcher fielding record
- IndexedDB stores the current snapshot and a gameId-keyed local game backup without blocking LIVE input
- localStorage remains a compatibility fallback and fast boot mirror
- startup restores the newer IndexedDB snapshot when available
- manifest.webmanifest + service worker provide an offline application shell after the app has been successfully loaded/installed once
- navigation uses network-first with cached index fallback; LIVE scoring itself has no network dependency
- the header changes to "オフライン準備済" after serviceWorker.ready
- printable A4 landscape scorebook output contains MY TEAM and opponent on separate pages and can be saved as PDF through the browser print flow
- IndexedDB `syncQueue` stores game revisions waiting for server reconciliation
- sync envelope key = gameId + local revision + event sequence
- game-end queues locally without network wait
- client marks uploaded only after matching server reconciliation
- stale revision / mismatched gameId / mismatched idempotency key cannot mark uploaded
- production API transport is intentionally not connected yet; see `SYNC_PROTOCOL.md`
- LIVE Undo / Redo and last-input confirmation are pinned above the bottom navigation
- complex-play completion returns the viewport to the pitch pad automatically
- regulation innings are selectable as 6 / 7 / 9 with 7 as the default
- tied regulation games continue to extra innings
- if the home side leads after the top of the regulation inning or later, the unused bottom half is skipped
- a home-side lead created during the bottom of regulation or later ends the game as a walkoff
- time-limit / mercy-rule tournament variations remain manual because they are competition-specific
- complex runner plays support "state only -> next pitch" quick commit
- quick commit updates bases / outs / runs immediately and stores Play.needsReview=true
- pending quick commits are visible in History and can be marked reviewed without changing the recorded result
- review resolution creates a revision record and is Undo / Redo reversible
- History supports past runner-result correction for batted-ball plays
- correction runs a downstream replay preview before apply
- replay detects runner-source mismatch, destination occupancy conflicts, batter mismatch, substitution conflicts, and missing checkpoints
- conflict-free corrections recalculate current inning / half / outs / count / bases / score / batting order
- after correction, batting stats, BOX runner paths and markers, pitcher stats, and fielding stats are rebuilt from the structured ledger
- scorer responsible-pitcher and earned/unearned overrides are preserved across rebuilds
- deferred fielding-path correction reassigns PO/A/E/DP contributions without changing game state
- replay checkpoints are stored every 12 plays to avoid full-game snapshots on every event
- responsible fielder can be corrected historically without changing outs / bases / score
- historical fielding correction updates BOX notation and recalculates PO / A / E / DP contributions
- historical batting-result correction supports 1B / 2B / 3B / HR / OUT / FC / E / SH / SF / GDP for batted-ball plays
- correction preview blocks invalid FC / SH / SF / GDP scoring situations and downstream runner / batter conflicts
- dropped-third cause E stores the responsible fielder number structurally and rebuilds the same fielding error
- historical scoring correction UI can change RBI yes/no and earned/non-earned for scoring RunnerAction records
- unresolved quick-commit plays are counted and surfaced in LIVE and the History tab
- BOX screen also warns when unresolved quick-commit reviews remain
- stolen-base runner event supports multiple selected runners for double-steal situations
- clear third-out force / batter-runner-first-out situations at two outs reject scoring before commit
- tag-out time plays remain scorer-controlled rather than being auto-invalidated
- measured serialized game size: about 229 KB at 54 plate appearances / 162 pitches and about 525 KB at 100 plate appearances / 300 pitches in the current stress fixture
- Undo / Redo snapshots are held as serialized JSON strings (max 80) so ordinary pitch entry avoids an immediate stringify+parse deep clone

Verification:
- syntax check PASS
- minimal startup runtime check PASS with a DOM stub
- 3 consecutive strikeouts -> top/bottom transition -> Undo -> Redo smoke test PASS
- core multi-runner scenario PASS from actual pitch/play inputs:
  - 1 out, runners first/third
  - shortstop ground ball / 6-4 force at second
  - third-base runner scores
  - batter-runner safe at first
  - BOX runner markers update
  - one-step Undo restores outs/bases/score
  - Redo restores the completed play
- focused logic tests PASS for simultaneous-substitution atomic Undo/Redo, dual-team substitution routing, per-pitcher aggregation, and fielding PO/A/DP
- in-play raw Pitch[] + PO/A fielding integration PASS for 6-3 groundout and 8 flyout
- inherited-runner test PASS: runner reaches vs predecessor, reliever enters, runner scores, R/ER remain with predecessor
- mid-count pitching-change tests PASS: 2-0 -> walk belongs predecessor; 2-0 -> hit belongs reliever
- fielder-choice liability-transfer test PASS: inherited runner forced out, replacement runner later scores, predecessor retains R/ER
- WP, pitcher R/ER Undo, and Redo focused tests PASS
- bases-loaded HBP test PASS: forced run + RBI + DB scorecard path
- passed-ball fielding test PASS: catcher PB increments once per PB event
- passed-ball earned-run test PASS: later score defaults to ○ / pitcher R without ER
- batting-interference test PASS: PA + 妨出, no AB, fielder E, forced RBI, default ○ / non-earned
- runner-special flow PASS:
  - rundown with explicit 1-3-6-3 route => PO/A aggregation + runner out marker
  - appeal out => structured outType=appeal + selected fielder PO
  - runner interference => structured outType=interference + one-step Undo restoration
  - obstruction advancement => affected runner defaults to ○ / non-earned if later scoring
- post-error secondary-play test PASS:
  - E6 followed by 6-5 runner out remains one Play
  - FieldingAction[] contains separate error and out actions
  - fielding totals: E6 + A6 + PO5
  - Undo restores bases / outs / scorecard

Additional correction / complex-play implementation:
- History has scorer correction UI for responsible pitcher and earned/unearned run
- correction creates GameRevision/Audit-style revision data and is itself Undo/Redo reversible
- arbitrary throw-path editor supports extended routes such as 6-4-3 and 5-2-5-1-2 without flattening them to a single text token
- extended throw paths feed BOX notation and PO/A/DP fielding aggregation
- fielder-choice inherited-runner liability transfer is stored structurally; ambiguous multi-liability cases remain scorer-review candidates

Verification added:
- scorer correction test PASS: predecessor charged ● -> correction to reliever + ○ -> Undo -> Redo
- 6-4-3 extended route test PASS with PO/A/DP aggregation
- 5-2-5-1-2 extended route test PASS with full path retained
- HBP one-tap test PASS: PA/HBP/BF, raw Pitch result, forced runner advance
- declared IBB one-tap test PASS: zero added pitches, BB/IBB/BF and first-base award
- balk test PASS: automatic one-base RunnerAction and BK pitcher stat
- pickoff test PASS: runner out at current base, Ⅰ marker, fieldingPath 1-3, A1/PO3
- PWA source validation PASS: index JavaScript syntax, service-worker syntax, manifest JSON and service-worker registration
- actual iPhone offline restart / airplane-mode acceptance test is still REQUIRED before the zero-network MVP criterion is marked complete
- service-worker offline-fallback synthetic test PASS: shell precache exists and failed navigation resolves to cached index.html
- consolidated regression suite PASS on the same branch revision:
  - top/bottom transition + Undo/Redo
  - multi-runner 1-out first/third -> 6-4 force + run + batter safe
  - HBP / IBB / BK
  - pickoff 1-3
  - two-strike pinch-hit strikeout attribution
  - pinch runner + SB ownership
  - inherited-runner pitcher responsibility + scorer correction Undo
  - extended 6-4-3 route

- GitHub Actions regression suite is installed on the development branch
- deterministic regression suite currently covers 35 scenarios:
  - top/bottom transition + Undo/Redo
  - core multi-runner FC + atomic Undo/Redo
  - two-strike pinch-hit attribution
  - inherited-runner pitcher responsibility
  - rundown + post-error secondary fielding
  - HBP / PB / batting interference
  - full 7-inning and 9-inning progression
  - local restart + sync reconciliation guard
  - full offline 7-inning game with mid-game save/load restart
  - derived batting / pitching analytics formulas
  - regulation inning / extra inning / walkoff finish
  - pinned one-tap LIVE Undo/Redo + non-contact BOX rendering
  - next-pitch-first quick commit + pending review
  - quick-play review resolution + Undo
  - deferred fielding-path correction with PO/A reassignment + Undo
  - replay checkpoints every 12 plays without recursive snapshot growth
  - dry-run ledger replay matches live operational state
  - replay conflict detection blocks downstream base / batter inconsistencies
  - solo HR credits batter RBI
  - past runner-state correction recalculates outs / bases / BOX / stats + Undo
  - full derived rebuild reproduces batting / BOX / pitching / fielding
  - scorer earned-run override survives later replay rebuild
  - historical batting-result correction OUT -> 1B with full derived rebuild + Undo
  - historical correction UI result switch + safe preview
  - FC requires an existing runner in LIVE
  - historical E -> FC with force-out / fielding-stat recalculation
  - historical 1B -> OUT is blocked when downstream runner dependency would break
  - SH / SF / GDP / FC prerequisite validation during historical correction
  - dropped-third E attribution to selected fielder + rebuild + Undo
  - historical RBI / earned-run override correction + Undo
  - historical responsible-fielder correction (6-3 -> 5-3) + BOX / A / PO reassignment + Undo
  - pending-review count visible in LIVE and History navigation
  - BOX also surfaces unresolved quick-commit review count with direct History shortcut
  - double steal stores multiple RunnerAction records in one runner event and Undo restores atomically
  - two-out clear force third-out rule blocks invalid runs while tag time-plays remain scorer judgment
- latest completed GitHub Actions regression run: 35 / 35 PASS on development branch
- additional focused serialized-snapshot test PASS:
  - one-pitch Undo / Redo
  - multi-runner play Undo / Redo

Next:
- run DEVICE_ACCEPTANCE.md on real iPhone and iPad hardware before declaring the zero-network MVP complete
- record any device-specific latency / PWA / Safari restart defects and fix only verified failures
- add historical correction for non-batted terminal results only where raw Pitch[] consistency can be preserved safely
- strengthen scorer override UI for unusual interference / appeal responsibility cases
- implement authenticated server endpoint described in SYNC_PROTOCOL.md
- server-side idempotency store and authoritative reconciliation
- server-side event validation / aggregation

## References
- Visco mobile scorebook guide:
  https://www.mster.co.jp/products/visco_mobile/guide/appendix/scorebook/
- Visco mobile score notation:
  https://www.mster.co.jp/products/visco_mobile/guide/appendix/scoremark/
- Visco mobile score options:
  https://www.mster.co.jp/products/visco_mobile/guide/options/scoreoption/
- Visco mobile play input:
  https://www.mster.co.jp/products/visco_mobile/guide/play/
- Visco mobile play confirmation / scorer adjustments:
  https://www.mster.co.jp/products/visco_mobile/guide/play/playing-confirm/
- Visco mobile stats detail:
  https://www.mster.co.jp/products/visco_mobile/guide/stats/stats-detail/
