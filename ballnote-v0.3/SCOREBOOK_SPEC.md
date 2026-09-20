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
- pitcher identity follows the active defensive P position
- when the pitcher is not registered, stats are retained under an explicit unknown-pitcher bucket rather than guessed
- inherited-runner runs and earned runs are intentionally not auto-assigned yet

Fielding aggregation now implemented from structured play data:
- PO from the fielder who completes each recorded out
- A from the structured throw path, with at most one assist per fielder in the same play
- E from explicit error result + responsible fielder
- DP participation for fielders involved in a recorded multi-out play
- fielding percentage = (PO + A) / (PO + A + E)
- normal strikeout credits the catcher with the rules-based putout

Still required:
- advanced pitcher responsibility / inherited-runner and earned-run logic
- scorer override for ambiguous fielding sequences, rundowns, interference, and post-error secondary plays

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

Raw pitch / persistence / output now implemented:
- Game receives a device-generated gameId
- Pitch[] is canonical raw pitch data with global sequence, inning/half, offense/defense team, batter, pitcher, pitch result, count before/after, outs and bases context
- scorecards store pitchIds and render pitch marks from Pitch[]; legacy display marks remain only as compatibility fallback
- strikeout / walk / in-play / dropped-third flows all connect to structured Play records
- IndexedDB stores the current snapshot and a gameId-keyed local game backup without blocking LIVE input
- localStorage remains a compatibility fallback and fast boot mirror
- startup restores the newer IndexedDB snapshot when available
- printable A4 landscape scorebook output contains MY TEAM and opponent on separate pages and can be saved as PDF through the browser print flow

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

Next:
- inherited-runner / earned-run responsibility with scorer override
- expanded error and FC responsibility rules
- special fielding sequences: rundowns, interference, appeals, post-error secondary plays
- cloud upload / idempotent reconciliation
- printable/PDF score sheet
- IndexedDB persistence

## References
- Visco mobile scorebook guide:
  https://www.mster.co.jp/products/visco_mobile/guide/appendix/scorebook/
- Visco mobile score notation:
  https://www.mster.co.jp/products/visco_mobile/guide/appendix/scoremark/
- Visco mobile score options:
  https://www.mster.co.jp/products/visco_mobile/guide/options/scoreoption/
