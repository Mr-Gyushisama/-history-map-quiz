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
Store substitutions as events, not as overwritten lineup values.
Required:
- pinch hitter
- pinch runner
- defensive substitution
- position change
- pitching change
- simultaneous changes
Scorebook rendering must show the timing in the count area and preserve player appearance history.

## 8. Data model
Canonical data is structured, not the rendered notation.
Score notation is generated from:
- Pitch[]
- PlateAppearance
- BattedBall
- FieldingAction[]
- RunnerAction[]
- SubstitutionEvent[]
- FinalResult

## 9. Strikeout / dropped third strike
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

## 10. Sacrifice / double play
Current scoring rules:
- SH: before two outs, at least one runner advances, batter is recorded out in the current MVP path, PA increments, AB does not
- SF: before two outs, at least one runner scores, batter is out, PA increments, AB does not
- GDP: at least two outs in the same continuous Play, PA and AB increment

Scorer judgment remains authoritative for borderline sacrifice/error/FC cases. Future scorer override will support sacrifice credit where the batter reaches because of an error or unsuccessful play on another runner.

## 11. Undo / correction
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

## 12. v0.3 implementation scope
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

Next:
- expanded error and FC responsibility rules
- substitutions and position changes
- opponent-side full scoring
- printable/PDF score sheet
- IndexedDB persistence

## References
- Visco mobile scorebook guide:
  https://www.mster.co.jp/products/visco_mobile/guide/appendix/scorebook/
- Visco mobile score notation:
  https://www.mster.co.jp/products/visco_mobile/guide/appendix/scoremark/
- Visco mobile score options:
  https://www.mster.co.jp/products/visco_mobile/guide/options/scoreoption/
