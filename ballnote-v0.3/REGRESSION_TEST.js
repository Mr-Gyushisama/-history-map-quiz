'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_PATH = path.join(__dirname, 'index.html');
const html = fs.readFileSync(INDEX_PATH, 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('BALLNOTE script block not found');

const baseScript = match[1];
const BOOT = 'load();render();registerOfflineShell();restoreIndexedDB();';

function runScenario(body) {
  if (!baseScript.includes(BOOT)) throw new Error('Boot marker changed; update regression harness');
  const script = baseScript.replace(BOOT, body + '\nrender();');
  const storage = {};
  const app = { innerHTML: '', addEventListener() {} };
  const context = {
    console,
    Date,
    Math,
    JSON,
    window: { print() {}, indexedDB: null },
    navigator: { serviceWorker: null },
    indexedDB: null,
    document: {
      getElementById() { return app; },
      createElement() { return { style: {}, appendChild() {}, setAttribute() {} }; },
      body: { appendChild() {} }
    },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
      setItem(k, v) { storage[k] = String(v); }
    },
    setTimeout(cb) { cb(); }
  };
  context.globalThis = context;
  vm.runInNewContext(script, context, { filename: 'ballnote-index-script.js' });
  return context.__testResult;
}

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ' expected=' + expected + ' actual=' + actual);
  }
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('top-bottom transition and Undo/Redo', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
for(var i=0;i<9;i++)pitch('strike');
var topState={inning:st.g.inning,half:st.g.half,offense:offenseKey(),selfBi:st.g.bi,oppBi:st.g.oppBi,outs:st.g.outs};
for(var j=0;j<9;j++)pitch('strike');
var bottomState={inning:st.g.inning,half:st.g.half,offense:offenseKey(),selfBi:st.g.bi,oppBi:st.g.oppBi,outs:st.g.outs};
undo();
var undone={inning:st.g.inning,half:st.g.half,outs:st.g.outs,s:st.g.count.s,oppBi:st.g.oppBi};
redo();
var redone={inning:st.g.inning,half:st.g.half,outs:st.g.outs};
globalThis.__testResult={top:topState,bottom:bottomState,undone:undone,redone:redone};
`);
  equal(r.top.half, 'bottom', 'top half did not advance to bottom');
  equal(r.top.offense, 'opp', 'opponent should bat in bottom for self away');
  equal(r.bottom.inning, 2, 'bottom half did not advance inning');
  equal(r.bottom.half, 'top', 'bottom half did not advance to top');
  equal(r.undone.inning, 1, 'Undo did not restore inning');
  equal(r.undone.half, 'bottom', 'Undo did not restore half');
  equal(r.undone.outs, 2, 'Undo did not restore outs');
  equal(r.undone.s, 2, 'Undo did not restore count');
  equal(r.redone.inning, 2, 'Redo did not restore inning transition');
});

test('core multi-runner FC play and atomic Undo/Redo', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
prepareRunnerEvent('wild_pitch');commitRunnerEvent();
prepareRunnerEvent('wild_pitch');commitRunnerEvent();
completeHBP();
pitch('strike');pitch('strike');pitch('strike');
var before={outs:st.g.outs,first:st.g.bases.first,third:st.g.bases.third,score:scoreOf('self')};
st.play={shape:'G',fielder:'6',target:'4',throwPath:['6','4'],result:'',runnerActions:[]};beginInplay('FC');commitInplay();
var after={outs:st.g.outs,first:st.g.bases.first,second:st.g.bases.second,third:st.g.bases.third,score:scoreOf('self'),runnerOut:st.g.scorecards[1].finalOutNumber,runMarker:st.g.scorecards[0].finalMarker};
undo();
var undone={outs:st.g.outs,first:st.g.bases.first,third:st.g.bases.third,score:scoreOf('self')};
redo();
var redone={outs:st.g.outs,first:st.g.bases.first,score:scoreOf('self')};
globalThis.__testResult={before:before,after:after,undone:undone,redone:redone};
`);
  equal(r.before.outs, 1, 'precondition outs');
  ok(r.before.first && r.before.third, 'precondition runners first/third');
  equal(r.after.outs, 2, 'FC should create second out');
  equal(r.after.second, null, 'second base should be empty');
  equal(r.after.third, null, 'third base runner should score');
  equal(r.after.score, 1, 'run should score');
  equal(r.after.runnerOut, 2, 'forced runner should be second out');
  equal(r.after.runMarker, '●', 'scoring runner should be marked');
  equal(r.undone.outs, 1, 'Undo should restore outs');
  equal(r.undone.score, 0, 'Undo should restore score');
  equal(r.redone.outs, 2, 'Redo should restore outs');
  equal(r.redone.score, 1, 'Redo should restore score');
});

test('two-strike pinch hitter strikeout attribution', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
pitch('strike');pitch('strike');
commitPinchHit('p10');
pitch('strike');
globalThis.__testResult={p1K:st.g.stats.p1.K,p10K:st.g.stats.p10.K,cardPlayer:st.g.scorecards[0].playerId,statOwner:st.g.scorecards[0].statOwnerId};
`);
  equal(r.p1K, 1, 'strikeout should belong to original batter');
  equal(r.p10K, 0, 'pinch hitter should not receive inherited two-strike K');
  equal(r.cardPlayer, 'p10', 'scorecard should show pinch hitter');
  equal(r.statOwner, 'p1', 'scorecard stat owner should preserve original batter');
});

test('inherited runner remains predecessor pitcher responsibility', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
for(var i=0;i<9;i++)pitch('strike');
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
var card=st.g.scorecards[3];
commitDefensiveSub('p9','p10');
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('3B');commitInplay();
globalThis.__testResult={responsible:card.responsiblePitcherId,charged:card.chargedPitcherId,p9:cp(st.g.pitcherStats.p9),p10:cp(st.g.pitcherStats.p10),score:scoreOf('opp')};
`);
  equal(r.responsible, 'p9', 'runner responsibility should stay with predecessor');
  equal(r.charged, 'p9', 'run should charge predecessor');
  equal(r.p9.R, 1, 'predecessor R');
  equal(r.p9.ER, 1, 'predecessor ER');
  equal(r.p10.R, 0, 'reliever must not receive inherited R');
  equal(r.score, 1, 'opponent run should score');
});

test('runner special rundown and post-error secondary fielding', () => {
  const r = runScenario(`
var out={};
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
prepareRunnerEvent('rundown');st.runnerPlay.fieldingPath=['1','3','6','3'];commitRunnerEvent();
out.rundown={outs:st.g.outs,marker:st.g.scorecards[0].finalOutNumber,f1:st.g.fieldingStats['unknown_opp_pos_1'],f3:st.g.fieldingStats['unknown_opp_pos_3'],f6:st.g.fieldingStats['unknown_opp_pos_6']};
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.undo=[];st.redo=[];
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
st.play={shape:'G',fielder:'6',target:'3',throwPath:[],result:'',runnerActions:[]};beginInplay('E');
st.play.runnerActions[0].to='out';st.play.runnerActions[0].outcome='out';st.play.runnerActions[0].outAt='third';st.play.runnerActions[0].outBy='5';st.play.runnerActions[0].outType='tag';st.play.throwPath=['6','5'];commitInplay();
var play=st.g.plays[st.g.plays.length-1];
out.secondary={sequence:play.fieldingSequenceType,actions:play.fieldingActions,ss:st.g.fieldingStats['unknown_opp_pos_6'],third:st.g.fieldingStats['unknown_opp_pos_5']};
globalThis.__testResult=out;
`);
  equal(r.rundown.outs, 1, 'rundown out');
  equal(r.rundown.marker, 1, 'rundown scorecard out marker');
  equal(r.rundown.f3.PO, 1, 'rundown final fielder putout');
  equal(r.rundown.f1.A, 1, 'rundown pitcher assist');
  equal(r.rundown.f6.A, 1, 'rundown shortstop assist');
  equal(r.secondary.sequence, 'post_error_secondary', 'secondary play classification');
  equal(r.secondary.actions.length, 2, 'error + out should be separate FieldingActions');
  equal(r.secondary.ss.E, 1, 'shortstop error');
  equal(r.secondary.ss.A, 1, 'shortstop secondary assist');
  equal(r.secondary.third.PO, 1, 'third baseman secondary putout');
});

test('HBP / PB / batting interference scoring', () => {
  const r = runScenario(`
var out={};
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
st.g.bases={first:'p2',second:'p3',third:'p4'};completeHBP();
out.hbp={score:scoreOf('self'),rbi:st.g.stats.p1.RBI,hbp:st.g.stats.p1.HBP,ab:st.g.stats.p1.AB,advance:st.g.scorecards[0].advances[0]};
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.undo=[];st.redo=[];
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');prepareRunnerEvent('passed_ball');commitRunnerEvent();
out.pb={second:st.g.bases.second,catcher:st.g.fieldingStats['unknown_opp_pos_2']};
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.undo=[];st.redo=[];
st.g.bases={first:'p2',second:'p3',third:'p4'};
st.g.scorecards=[
{id:'c2',teamKey:'self',playerId:'p2',activeRunnerId:'p2',order:2,inning:1,result:'1B',advances:[{from:'home',to:'first',reason:'batted_ball'}],finalMarker:'',finalOutNumber:0,responsiblePitcherId:'unknown_opp_pitcher',responsiblePitcherTeam:'opp',earnedRunEligible:true,runCharged:false,substitutions:[]},
{id:'c3',teamKey:'self',playerId:'p3',activeRunnerId:'p3',order:3,inning:1,result:'1B',advances:[{from:'home',to:'second',reason:'batted_ball'}],finalMarker:'',finalOutNumber:0,responsiblePitcherId:'unknown_opp_pitcher',responsiblePitcherTeam:'opp',earnedRunEligible:true,runCharged:false,substitutions:[]},
{id:'c4',teamKey:'self',playerId:'p4',activeRunnerId:'p4',order:4,inning:1,result:'1B',advances:[{from:'home',to:'third',reason:'batted_ball'}],finalMarker:'',finalOutNumber:0,responsiblePitcherId:'unknown_opp_pitcher',responsiblePitcherTeam:'opp',earnedRunEligible:true,runCharged:false,substitutions:[]}
];
st.interferenceDraft={fielder:'2'};completeInterference();
out.intf={score:scoreOf('self'),rbi:st.g.stats.p1.RBI,intf:st.g.stats.p1.INTF,marker:st.g.scorecards[2].finalMarker,catcher:st.g.fieldingStats['unknown_opp_pos_2'],pitcher:st.g.pitcherStats['unknown_opp_pitcher']};
globalThis.__testResult=out;
`);
  equal(r.hbp.score, 1, 'bases-loaded HBP run');
  equal(r.hbp.rbi, 1, 'bases-loaded HBP RBI');
  equal(r.hbp.hbp, 1, 'HBP stat');
  equal(r.hbp.ab, 0, 'HBP should not count AB');
  equal(r.hbp.advance.label, 'DB', 'HBP scorecard path');
  equal(r.pb.catcher.PB, 1, 'catcher PB');
  equal(r.intf.rbi, 1, 'forced run on batting interference RBI');
  equal(r.intf.marker, '○', 'interference forced run should default unearned');
  equal(r.intf.catcher.E, 1, 'responsible fielder error');
  equal(r.intf.pitcher.ER, 0, 'interference run should not be earned by default');
});

test('7 and 9 inning full progression', () => {
  const r7 = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
for(var i=0;i<126;i++)pitch('strike');
globalThis.__testResult={inning:st.g.inning,half:st.g.half,outs:st.g.outs,cards:st.g.scorecards.length,self:st.g.scorecards.filter(function(c){return c.teamKey==='self'}).length,opp:st.g.scorecards.filter(function(c){return c.teamKey==='opp'}).length};
`);
  equal(r7.inning, 8, '7 innings should end at top 8 state');
  equal(r7.half, 'top', '7 innings half');
  equal(r7.outs, 0, '7 innings outs reset');
  equal(r7.cards, 42, '7 innings total plate appearances in 3-up-3-down case');
  equal(r7.self, 21, '7 innings self PAs');
  equal(r7.opp, 21, '7 innings opponent PAs');

  const r9 = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
for(var i=0;i<162;i++)pitch('strike');
globalThis.__testResult={inning:st.g.inning,half:st.g.half,outs:st.g.outs,cards:st.g.scorecards.length};
`);
  equal(r9.inning, 10, '9 innings should end at top 10 state');
  equal(r9.half, 'top', '9 innings half');
  equal(r9.outs, 0, '9 innings outs reset');
  equal(r9.cards, 54, '9 innings total plate appearances in 3-up-3-down case');
});

test('local restart restore and sync reconciliation guard', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
pitch('ball');save();
var gameId=st.g.gameId,rev=st.g.revision,count=cp(st.g.count);
st.g=null;load();
var restored={gameId:st.g.gameId,revision:st.g.revision,b:st.g.count.b};
var env=queueSyncEnvelope('regression');
var bad=applyServerReconciliation({gameId:st.g.gameId,idempotencyKey:'wrong',acceptedRevision:999,acceptedSequence:999,status:'accepted'});
var good=applyServerReconciliation({gameId:st.g.gameId,idempotencyKey:env.idempotencyKey,acceptedRevision:env.revision,acceptedSequence:env.eventSequence,serverRevision:env.revision,status:'accepted'});
globalThis.__testResult={expected:{gameId:gameId,revision:rev,b:count.b},restored:restored,bad:bad,good:good,status:st.g.sync.status};
`);
  equal(r.restored.gameId, r.expected.gameId, 'restart gameId');
  equal(r.restored.revision, r.expected.revision, 'restart revision');
  equal(r.restored.b, r.expected.b, 'restart count');
  equal(r.bad, false, 'mismatched reconciliation must fail');
  equal(r.good, true, 'matching reconciliation should pass');
  equal(r.status, 'uploaded', 'matching reconciliation uploaded state');
});


test('offline full 7-inning game survives mid-game restart', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away',regulationInnings:7});st.view='live';
st.play={shape:'F',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('HR');
for(var i=0;i<9;i++)pitch('strike');
for(var j=0;j<9;j++)pitch('strike');
for(var k=0;k<54;k++)pitch('strike');
var before={gameId:st.g.gameId,inning:st.g.inning,half:st.g.half,self:scoreOf('self'),opp:scoreOf('opp'),cards:st.g.scorecards.length,bi:st.g.bi,oppBi:st.g.oppBi};
save();
st.g=null;load();
var restored={gameId:st.g.gameId,inning:st.g.inning,half:st.g.half,self:scoreOf('self'),opp:scoreOf('opp'),cards:st.g.scorecards.length,bi:st.g.bi,oppBi:st.g.oppBi};
for(var z=0;z<54;z++)pitch('strike');
globalThis.__testResult={before:before,restored:restored,final:{over:st.g.over,reason:st.g.gameEndReason,inning:st.g.inning,half:st.g.half,self:scoreOf('self'),opp:scoreOf('opp'),cards:st.g.scorecards.length,sync:st.g.sync.status}};
`);
  equal(r.before.gameId, r.restored.gameId, 'restart must preserve gameId');
  equal(r.before.inning, 5, 'restart checkpoint inning');
  equal(r.before.half, 'top', 'restart checkpoint half');
  equal(r.restored.inning, r.before.inning, 'restart inning');
  equal(r.restored.half, r.before.half, 'restart half');
  equal(r.restored.self, 1, 'restart score');
  equal(r.restored.cards, r.before.cards, 'restart scorecards');
  equal(r.restored.bi, r.before.bi, 'restart self batting index');
  equal(r.restored.oppBi, r.before.oppBi, 'restart opponent batting index');
  equal(r.final.over, true, '7-inning game should finish');
  equal(r.final.reason, 'regulation_complete', 'away win regulation finish');
  equal(r.final.self, 1, 'final self score');
  equal(r.final.opp, 0, 'final opponent score');
  equal(r.final.sync, 'queued_local', 'finished offline game should remain locally queued');
});

test('derived batting and pitching analytics', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='data';
st.g.stats.p1.PA=7;st.g.stats.p1.AB=4;st.g.stats.p1.H=2;st.g.stats.p1.BB=1;st.g.stats.p1.HBP=1;st.g.stats.p1.SF=1;
st.g.scorecards=[
 {playerId:'p1',result:'1B'},
 {playerId:'p1',result:'2B'}
];
var bd=battingDerived('p1');
var pd=pitcherDerived({OUTS:6,ER:2,H:3,BB:1});
globalThis.__testResult={bd:bd,pd:pd};
`);
  equal(r.bd.AVG, '0.500', 'AVG');
  equal(r.bd.OBP, '0.571', 'OBP');
  equal(r.bd.SLG, '0.750', 'SLG');
  equal(r.bd.OPS, '1.321', 'OPS');
  equal(r.bd.TB, 3, 'total bases');
  equal(r.pd.ERA9, '9.00', 'ERA 9-inning equivalent');
  equal(r.pd.WHIP, '2.00', 'WHIP');
});


test('regulation innings, extra innings, and walkoff finish', () => {
  const r = runScenario(`
var out={};
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away',regulationInnings:7});st.view='live';
st.g.inning=7;st.g.half='top';st.g.scores={self:1,opp:2};st.g.inningScores={self:[0,0,0,0,0,0,1],opp:[0,0,0,0,0,0,2]};st.g.outs=3;inningCheck();
out.skipBottom={over:st.g.over,reason:st.g.gameEndReason,inning:st.g.inning,half:st.g.half};

st.g=game({date:'2026-09-20',opponent:'TEST',side:'away',regulationInnings:7});st.undo=[];st.redo=[];st.view='live';
st.g.inning=7;st.g.half='bottom';st.g.scores={self:2,opp:2};st.g.inningScores={self:[0,0,0,0,0,0,2],opp:[0,0,0,0,0,0,2]};st.g.outs=3;inningCheck();
out.extra={over:st.g.over,inning:st.g.inning,half:st.g.half,outs:st.g.outs};

st.g=game({date:'2026-09-20',opponent:'TEST',side:'home',regulationInnings:7});st.undo=[];st.redo=[];st.view='live';
st.g.inning=7;st.g.half='bottom';st.g.scores={self:2,opp:2};st.g.inningScores={self:[0,0,0,0,0,0,2],opp:[0,0,0,0,0,0,2]};st.g.bases={first:'p2',second:'p3',third:'p4'};completeHBP();
out.walkoff={over:st.g.over,reason:st.g.gameEndReason,self:scoreOf('self'),opp:scoreOf('opp')};
globalThis.__testResult=out;
`);
  equal(r.skipBottom.over, true, 'home lead after top regulation should end game');
  equal(r.skipBottom.reason, 'home_lead_after_top', 'skip-bottom reason');
  equal(r.extra.over, false, 'tie after regulation should continue');
  equal(r.extra.inning, 8, 'tie should advance to extra inning');
  equal(r.extra.half, 'top', 'extra inning should start at top');
  equal(r.walkoff.over, true, 'walkoff should end game');
  equal(r.walkoff.reason, 'walkoff', 'walkoff reason');
  equal(r.walkoff.self, 3, 'walkoff score');
});

test('LIVE keeps one-tap Undo/Redo and suppresses non-contact batted-ball shape', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
var html=live();
var hbpCard=addScorecard(bat(),'DB','HBP');
globalThis.__testResult={
  undoCount:(html.match(/data-act="undo"/g)||[]).length,
  redoCount:(html.match(/data-act="redo"/g)||[]).length,
  sticky:html.indexOf('live-undo-bar')>=0,
  hbpShape:scoreShape(hbpCard)
};
`);
  equal(r.undoCount, 1, 'LIVE should expose one Undo button');
  equal(r.redoCount, 1, 'LIVE should expose one Redo button');
  equal(r.sticky, true, 'LIVE should render sticky Undo bar');
  equal(r.hbpShape, '', 'HBP must not render stale batted-ball symbol');
});

test('quick commit preserves game state and queues detail review', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away',regulationInnings:7});st.view='live';
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
st.play={shape:'G',fielder:'6',target:'4',throwPath:[],result:'',runnerActions:[]};beginInplay('FC');
commitInplay(true);
var play=st.g.plays[st.g.plays.length-1];
var committed={needsReview:play.needsReview,reason:play.reviewReason,modal:st.modal,b:st.g.count.b,s:st.g.count.s,history:history().indexOf('要確認')>=0,bi:st.g.bi};
undo();
globalThis.__testResult={committed:committed,undo:{plays:st.g.plays.length,bi:st.g.bi,first:st.g.bases.first,second:st.g.bases.second,third:st.g.bases.third}};
`);
  equal(r.committed.needsReview, true, 'quick commit needsReview');
  equal(r.committed.reason, 'quick_commit', 'quick commit review reason');
  equal(r.committed.modal, '', 'quick commit should close modal');
  equal(r.committed.b, 0, 'quick commit ball count reset');
  equal(r.committed.s, 0, 'quick commit strike count reset');
  equal(r.committed.history, true, 'quick commit should appear in history');
  equal(r.undo.plays, 1, 'Undo should remove quick-committed play');
  equal(r.undo.bi, 1, 'Undo should restore batting index');
  equal(r.undo.first, 'p1', 'Undo should restore existing runner');
});

test('quick-play review can be resolved and undone', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
st.play={shape:'G',fielder:'6',target:'4',throwPath:[],result:'',runnerActions:[]};beginInplay('FC');commitInplay(true);
var id=st.g.plays[st.g.plays.length-1].id;
resolvePlayReview(id);
var resolved={flag:playById(id).reviewResolved,pending:(history().match(/data-resolve-play/g)||[]).length,revisions:st.g.revisions.length};
undo();
globalThis.__testResult={resolved:resolved,undo:{flag:playById(id).reviewResolved,revisions:st.g.revisions.length}};
`);
  equal(r.resolved.flag, true, 'review should resolve');
  equal(r.resolved.pending, 0, 'resolved play should leave pending list');
  equal(r.resolved.revisions, 1, 'review resolution should create revision');
  equal(r.undo.flag, false, 'Undo should reopen review');
  equal(r.undo.revisions, 0, 'Undo should restore revision list');
});

test('deferred fielding-path correction reassigns fielding stats and undoes cleanly', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
st.play={shape:'G',fielder:'6',target:'4',throwPath:['6','3'],result:'',runnerActions:[]};beginInplay('FC');
st.play.runnerActions[0].outBy='3';
commitInplay(true);
var id=st.g.plays[st.g.plays.length-1].id;
var before={
  path:playById(id).battedBall.throwPath.join('-'),
  a6:st.g.fieldingStats['unknown_opp_pos_6'].A,
  po3:st.g.fieldingStats['unknown_opp_pos_3'].PO,
  po4:st.g.fieldingStats['unknown_opp_pos_4']?st.g.fieldingStats['unknown_opp_pos_4'].PO:0
};
beginPlayFieldingEdit(id);
st.playEditDraft.fieldingPath=['6','4'];
commitPlayFieldingEdit();
var after={
  path:playById(id).battedBall.throwPath.join('-'),
  outBy:playById(id).runnerActions[0].outBy,
  a6:st.g.fieldingStats['unknown_opp_pos_6'].A,
  po3:st.g.fieldingStats['unknown_opp_pos_3'].PO,
  po4:st.g.fieldingStats['unknown_opp_pos_4'].PO,
  resolved:playById(id).reviewResolved,
  revisionType:st.g.revisions[st.g.revisions.length-1].type
};
undo();
var undone={
  path:playById(id).battedBall.throwPath.join('-'),
  outBy:playById(id).runnerActions[0].outBy,
  a6:st.g.fieldingStats['unknown_opp_pos_6'].A,
  po3:st.g.fieldingStats['unknown_opp_pos_3'].PO,
  po4:st.g.fieldingStats['unknown_opp_pos_4']?st.g.fieldingStats['unknown_opp_pos_4'].PO:0,
  resolved:playById(id).reviewResolved
};
globalThis.__testResult={before:before,after:after,undone:undone};
`);
  equal(r.before.path, '6-3', 'initial mistaken path');
  equal(r.before.a6, 1, 'initial shortstop assist');
  equal(r.before.po3, 1, 'initial wrong putout');
  equal(r.after.path, '6-4', 'corrected path');
  equal(r.after.outBy, '4', 'corrected runner outBy');
  equal(r.after.a6, 1, 'assist remains on shortstop');
  equal(r.after.po3, 0, 'old putout removed');
  equal(r.after.po4, 1, 'new putout credited');
  equal(r.after.resolved, true, 'correction resolves pending review');
  equal(r.after.revisionType, 'play_fielding_correction', 'correction revision type');
  equal(r.undone.path, '6-3', 'Undo restores old path');
  equal(r.undone.outBy, '3', 'Undo restores old outBy');
  equal(r.undone.po3, 1, 'Undo restores old putout');
  equal(r.undone.po4, 0, 'Undo removes corrected putout');
  equal(r.undone.resolved, false, 'Undo reopens review');
});

test('home run credits batter RBI including self', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
st.play={shape:'F',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('HR');
globalThis.__testResult={rbi:st.g.stats.p1.RBI,runs:st.g.stats.p1.R,score:scoreOf('self')};
`);
  equal(r.rbi, 1, 'solo HR should credit one RBI');
  equal(r.runs, 1, 'solo HR should credit one run');
  equal(r.score, 1, 'solo HR should score one run');
});

test('dry-run replay reproduces mixed live state from initial checkpoint', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away',regulationInnings:7});st.view='live';
ensureReplayCheckpoint(false);
var cp0=cp(st.g.replayCheckpoints[0]);
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
prepareRunnerEvent('stolen_base');commitRunnerEvent();
st.play={shape:'G',fielder:'6',target:'3',throwPath:['6','3'],result:'',runnerActions:[]};beginInplay('OUT');commitInplay(false);
for(var i=0;i<6;i++)pitch('strike');
commitDefensiveSub('p9','p10');
for(var j=0;j<9;j++)pitch('strike');
var check=validateReplayFromCheckpoint(cp0);
globalThis.__testResult={ok:check.ok,sim:replayOperationalFingerprint(check.simulated),cur:replayOperationalFingerprint(check.current)};
`);
  equal(r.ok, true, 'dry-run replay should match live state');
  equal(r.sim, r.cur, 'replay fingerprint');
});

test('replay checkpoints stay compact and appear every 12 plays', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
ensureReplayCheckpoint(false);
for(var i=0;i<36;i++)pitch('strike');
var last=st.g.replayCheckpoints[st.g.replayCheckpoints.length-1];
globalThis.__testResult={count:st.g.replayCheckpoints.length,plays:st.g.plays.length,lastPlayCount:last.playCount,nested:typeof last.state.replayCheckpoints!=='undefined'};
`);
  equal(r.plays, 12, 'fixture should create 12 plays');
  equal(r.count, 2, 'initial + 12-play checkpoint');
  equal(r.lastPlayCount, 12, 'checkpoint play count');
  equal(r.nested, false, 'checkpoint must not recursively contain checkpoints');
});

test('replay preview blocks downstream runner-state conflicts', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';ensureReplayCheckpoint(false);
var cp0=cp(st.g.replayCheckpoints[0]);
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
st.play={shape:'G',fielder:'6',target:'4',throwPath:['6','4'],result:'',runnerActions:[]};beginInplay('FC');commitInplay(true);
var target=cp(st.g.plays[st.g.plays.length-1]);
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');commitInplay(false);
var baseline=replayLedgerPreview(cp0,{});
var edited=cp(target);
for(var i=0;i<edited.runnerActions.length;i++)if(edited.runnerActions[i].playerId==='p1'){edited.runnerActions[i].outcome='safe';edited.runnerActions[i].to='second';edited.runnerActions[i].outAt='';edited.runnerActions[i].outBy=''}
var overrides={};overrides[target.id]=edited;
var preview=replayLedgerPreview(cp0,overrides);
globalThis.__testResult={baseline:baseline.conflicts,preview:preview.conflicts};
`);
  equal(r.baseline.length, 0, 'baseline replay should be conflict free');
  equal(r.preview.length, 1, 'edited replay should detect one downstream conflict');
  equal(r.preview[0].type, 'destination_occupied', 'conflict type');
  equal(r.preview[0].base, 'second', 'conflict base');
});

test('past runner correction recalculates state BOX and Undo', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';ensureReplayCheckpoint(false);
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
st.play={shape:'G',fielder:'6',target:'4',throwPath:['6','4'],result:'',runnerActions:[]};beginInplay('FC');commitInplay(true);
var target=st.g.plays[st.g.plays.length-1];
var before={outs:st.g.outs,first:st.g.bases.first,second:st.g.bases.second,p1Out:st.g.scorecards[0].finalOutNumber};
var edited=cp(target.runnerActions);
for(var i=0;i<edited.length;i++)if(edited[i].playerId==='p1'){edited[i].outcome='safe';edited[i].to='second';edited[i].outAt='';edited[i].outBy='';edited[i].outNumber=0}
var applied=applyRunnerCorrection(target.id,edited);
var after={outs:st.g.outs,first:st.g.bases.first,second:st.g.bases.second,p1Out:st.g.scorecards[0].finalOutNumber,p1Last:st.g.scorecards[0].advances[st.g.scorecards[0].advances.length-1].to,rev:st.g.revisions[st.g.revisions.length-1].type};
undo();
var undone={outs:st.g.outs,first:st.g.bases.first,second:st.g.bases.second,p1Out:st.g.scorecards[0].finalOutNumber};
globalThis.__testResult={applied:applied,before:before,after:after,undone:undone};
`);
  equal(r.applied.ok, true, 'runner correction should apply');
  equal(r.before.outs, 1, 'original out');
  equal(r.after.outs, 0, 'corrected outs');
  equal(r.after.first, 'p2', 'batter remains first');
  equal(r.after.second, 'p1', 'corrected runner reaches second');
  equal(r.after.p1Out, 0, 'BOX out marker removed');
  equal(r.after.p1Last, 'second', 'BOX advance corrected');
  equal(r.after.rev, 'play_runner_correction', 'revision type');
  equal(r.undone.outs, 1, 'Undo restores out');
  equal(r.undone.second, null, 'Undo clears corrected second base');
  equal(r.undone.p1Out, 1, 'Undo restores BOX out marker');
});

test('ledger rebuild preserves current batting BOX pitching and fielding', () => {
  const r = runScenario(`
function snapSummary(){
  var cards=st.g.scorecards.map(function(c){return{playerId:c.playerId,result:c.result,adv:(c.advances||[]).map(function(a){return[a.from,a.to,a.reason,a.label]}),marker:c.finalMarker,out:c.finalOutNumber}});
  return JSON.stringify({stats:st.g.stats,pitcherStats:st.g.pitcherStats,fieldingStats:st.g.fieldingStats,pitching:st.g.pitching,cards:cards});
}
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
st.play={shape:'F',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('HR');
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
prepareRunnerEvent('stolen_base');commitRunnerEvent();
pitch('ball');pitch('ball');pitch('ball');pitch('ball');
st.play={shape:'G',fielder:'6',target:'3',throwPath:['6','3'],result:'',runnerActions:[]};beginInplay('OUT');commitInplay(false);
for(var i=0;i<6;i++)pitch('strike');
var before=snapSummary();
rebuildAllDerivedFromLedger();
var after=snapSummary();
globalThis.__testResult={equal:before===after};
`);
  equal(r.equal, true, 'full derived rebuild should match live state');
});

test('scorer earned-run override survives later replay rebuild', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';ensureReplayCheckpoint(false);
st.play={shape:'G',fielder:'6',target:'3',throwPath:[],result:'',runnerActions:[]};beginInplay('E');
prepareRunnerEvent('wild_pitch');commitRunnerEvent();
prepareRunnerEvent('wild_pitch');commitRunnerEvent();
prepareRunnerEvent('wild_pitch');commitRunnerEvent();
var c1=st.g.scorecards[0];
beginRunReview(c1.id);st.reviewDraft.pitcherId='unknown_opp_pitcher';st.reviewDraft.earned=true;commitRunReview();
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
st.play={shape:'G',fielder:'6',target:'4',throwPath:['6','4'],result:'',runnerActions:[]};beginInplay('FC');commitInplay(true);
var target=st.g.plays[st.g.plays.length-1],edited=cp(target.runnerActions);
for(var i=0;i<edited.length;i++)if(!edited[i].isBatter){edited[i].outcome='safe';edited[i].to='second';edited[i].outAt='';edited[i].outBy='';edited[i].outNumber=0}
var applied=applyRunnerCorrection(target.id,edited);
c1=st.g.scorecards[0];
globalThis.__testResult={applied:applied.ok,marker:c1.finalMarker,override:c1.scorerEarnedOverride,er:st.g.pitcherStats['unknown_opp_pitcher'].ER};
`);
  equal(r.applied, true, 'later correction should apply');
  equal(r.marker, '●', 'scorer earned override should remain');
  equal(r.override, true, 'override flag should remain');
  equal(r.er, 1, 'pitcher ER should remain');
});

test('historical batting-result correction OUT to 1B rebuilds all derived state', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';ensureReplayCheckpoint(false);
st.play={shape:'G',fielder:'6',target:'3',throwPath:['6','3'],result:'',runnerActions:[]};beginInplay('OUT');
var p=st.g.plays[st.g.plays.length-1],chg=prepareRecordedResultChange(p.id,'1B');
var applied=applyPlayCorrection(p.id,chg.result,chg.runnerActions);
var after={
  applied:applied.ok,outs:st.g.outs,first:st.g.bases.first,h:st.g.stats.p1.H,
  pitcherH:st.g.pitcherStats['unknown_opp_pitcher'].H,
  pitcherOuts:st.g.pitcherStats['unknown_opp_pitcher'].OUTS,
  a6:st.g.fieldingStats['unknown_opp_pos_6']?st.g.fieldingStats['unknown_opp_pos_6'].A:0,
  po3:st.g.fieldingStats['unknown_opp_pos_3']?st.g.fieldingStats['unknown_opp_pos_3'].PO:0,
  result:st.g.scorecards[0].result,notation:st.g.scorecards[0].notation,outNo:st.g.scorecards[0].finalOutNumber
};
undo();
var undone={outs:st.g.outs,first:st.g.bases.first,h:st.g.stats.p1.H,result:st.g.scorecards[0].result,outNo:st.g.scorecards[0].finalOutNumber};
globalThis.__testResult={after:after,undone:undone};
`);
  equal(r.after.applied, true, 'result correction applies');
  equal(r.after.outs, 0, 'out removed');
  equal(r.after.first, 'p1', 'batter reaches first');
  equal(r.after.h, 1, 'hit added');
  equal(r.after.pitcherH, 1, 'pitcher hit added');
  equal(r.after.pitcherOuts, 0, 'pitcher out removed');
  equal(r.after.a6, 0, 'obsolete assist removed');
  equal(r.after.po3, 0, 'obsolete putout removed');
  equal(r.after.result, '1B', 'scorecard result');
  equal(r.after.notation, '6安', 'scorecard notation');
  equal(r.after.outNo, 0, 'BOX out marker removed');
  equal(r.undone.outs, 1, 'Undo restores out');
  equal(r.undone.result, 'OUT', 'Undo restores result');
  equal(r.undone.outNo, 1, 'Undo restores BOX out marker');
});

test('history correction UI can change result and preview safely', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';ensureReplayCheckpoint(false);
st.play={shape:'G',fielder:'6',target:'3',throwPath:['6','3'],result:'',runnerActions:[]};beginInplay('OUT');
var id=st.g.plays[st.g.plays.length-1].id;
st.view='history';beginPlayRunnerEdit(id);changePlayEditResult('1B');previewPlayRunnerEdit();
var html=modal();
globalThis.__testResult={result:st.playStateDraft.result,batterTo:st.playStateDraft.runnerActions[st.playStateDraft.runnerActions.length-1].to,canApply:html.indexOf('訂正を適用')>=0};
`);
  equal(r.result, '1B', 'draft result');
  equal(r.batterTo, 'first', 'result change regenerates batter action');
  equal(r.canApply, true, 'conflict-free correction shows apply');
});

test('FC requires an existing runner in LIVE', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
beginInplay('FC');
globalThis.__testResult={plays:st.g.plays.length,modal:st.modal,bases:cp(st.g.bases),result:st.play.result};
`);
  equal(r.plays, 0, 'no-runner FC must not create a play');
  equal(r.modal, '', 'no-runner FC must not open runner modal');
  equal(r.bases.first, null, 'no-runner FC must not alter bases');
});

test('historical E to FC with runner recalculates error and force out', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';ensureReplayCheckpoint(false);
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
st.play={shape:'G',fielder:'6',target:'4',throwPath:['6','4'],result:'',runnerActions:[]};beginInplay('E');commitInplay(true);
var p=st.g.plays[st.g.plays.length-1],chg=prepareRecordedResultChange(p.id,'FC');
var preview=playCorrectionPreview(p.id,chg.result,chg.runnerActions);
var applied=applyPlayCorrection(p.id,chg.result,chg.runnerActions);
globalThis.__testResult={
  preview:preview.ok,applied:applied.ok,result:st.g.scorecards[1].result,
  outs:st.g.outs,first:st.g.bases.first,second:st.g.bases.second,
  error6:st.g.fieldingStats['unknown_opp_pos_6']?st.g.fieldingStats['unknown_opp_pos_6'].E:0,
  assist6:st.g.fieldingStats['unknown_opp_pos_6']?st.g.fieldingStats['unknown_opp_pos_6'].A:0,
  po4:st.g.fieldingStats['unknown_opp_pos_4']?st.g.fieldingStats['unknown_opp_pos_4'].PO:0
};
`);
  equal(r.preview, true, 'E to FC preview');
  equal(r.applied, true, 'E to FC apply');
  equal(r.result, 'FC', 'scorecard result becomes FC');
  equal(r.outs, 1, 'force out added');
  equal(r.first, 'p2', 'batter reaches first');
  equal(r.second, null, 'forced runner removed');
  equal(r.error6, 0, 'old error removed');
  equal(r.assist6, 1, 'shortstop assist added');
  equal(r.po4, 1, 'second baseman putout added');
});

test('historical 1B to OUT is blocked when later play depends on runner', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';ensureReplayCheckpoint(false);
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');
var firstPlay=st.g.plays[st.g.plays.length-1];
st.play={shape:'L',fielder:'8',target:'',throwPath:[],result:'',runnerActions:[]};beginInplay('1B');commitInplay(false);
var chg=prepareRecordedResultChange(firstPlay.id,'OUT');
var preview=playCorrectionPreview(firstPlay.id,chg.result,chg.runnerActions);
globalThis.__testResult={ok:preview.ok,conflicts:preview.conflicts};
`);
  equal(r.ok, false, 'dependent later play must block correction');
  equal(r.conflicts[0].type, 'runner_source_mismatch', 'runner dependency conflict');
});

test('historical SH SF GDP enforce scoring prerequisites', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';ensureReplayCheckpoint(false);
st.play={shape:'G',fielder:'6',target:'3',throwPath:['6','3'],result:'',runnerActions:[]};beginInplay('OUT');
var p=st.g.plays[st.g.plays.length-1],out={};
['SH','SF','GDP','FC'].forEach(function(result){
  var chg=prepareRecordedResultChange(p.id,result);
  var preview=playCorrectionPreview(p.id,chg.result,chg.runnerActions);
  out[result]={ok:preview.ok,type:preview.conflicts[0]&&preview.conflicts[0].type};
});
globalThis.__testResult=out;
`);
  equal(r.SH.ok, false, 'SH without runner blocked');
  equal(r.SH.type, 'invalid_sac_bunt', 'SH conflict type');
  equal(r.SF.ok, false, 'SF without runner on third blocked');
  equal(r.SF.type, 'invalid_sac_fly', 'SF conflict type');
  equal(r.GDP.ok, false, 'GDP without runner first blocked');
  equal(r.GDP.type, 'invalid_double_play', 'GDP conflict type');
  equal(r.FC.ok, false, 'FC without runner blocked');
  equal(r.FC.type, 'result_requires_runner', 'FC conflict type');
});

test('dropped-third error attributes E to selected fielder and survives rebuild', () => {
  const r = runScenario(`
st.g=game({date:'2026-09-20',opponent:'TEST',side:'away'});st.view='live';
pitch('strike');pitch('strike');
prepareDroppedThird();
setDroppedCause('error');
setDroppedErrorFielder('6');
commitDroppedThird();
var before={
  first:st.g.bases.first,
  result:st.g.scorecards[0].result,
  cause:st.g.scorecards[0].droppedThirdCause,
  errorFielder:st.g.scorecards[0].droppedThirdErrorFielder,
  e6:st.g.fieldingStats['unknown_opp_pos_6']?st.g.fieldingStats['unknown_opp_pos_6'].E:0,
  playErrorFielder:st.g.plays[st.g.plays.length-1].errorFielderNumber
};
rebuildAllDerivedFromLedger();
var rebuilt={e6:st.g.fieldingStats['unknown_opp_pos_6']?st.g.fieldingStats['unknown_opp_pos_6'].E:0};
undo();
var undone={count:cp(st.g.count),plays:st.g.plays.length,e6:st.g.fieldingStats['unknown_opp_pos_6']?st.g.fieldingStats['unknown_opp_pos_6'].E:0};
globalThis.__testResult={before:before,rebuilt:rebuilt,undone:undone};
`);
  equal(r.before.first, 'p1', 'batter reaches first on dropped-third error');
  equal(r.before.result, 'K', 'scorecard remains strikeout notation');
  equal(r.before.cause, 'error', 'dropped-third cause');
  equal(r.before.errorFielder, '6', 'scorecard responsible fielder');
  equal(r.before.playErrorFielder, '6', 'play responsible fielder');
  equal(r.before.e6, 1, 'selected fielder error');
  equal(r.rebuilt.e6, 1, 'rebuild preserves selected fielder error');
  equal(r.undone.s, 2, 'Undo restores two-strike count');
  equal(r.undone.plays, 0, 'Undo removes dropped-third play');
  equal(r.undone.e6, 0, 'Undo removes error');
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log('PASS', t.name);
  } catch (err) {
    failed += 1;
    console.error('FAIL', t.name);
    console.error(err && err.stack ? err.stack : err);
  }
}

if (failed) {
  console.error('BALLNOTE regression: ' + failed + ' failed / ' + tests.length);
  process.exit(1);
}
console.log('BALLNOTE regression: all ' + tests.length + ' passed');
