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
