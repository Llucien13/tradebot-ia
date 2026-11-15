"""Experiments: 1 position, 1000 EUR ~=1150 USD, leverage 1:20, strict 2% risk; no monthly tuning; pre-declared causal setups. PAPER.
Runs on MT5 native M15 OHLC 2025 and 2026. M5 separate audit when available. No lookahead: htf bars are known only at *start of next native bar*.
"""
import pandas as pd,numpy as np,itertools,json,pathlib
from datetime import timedelta
DATA=pathlib.Path(__file__).resolve().parent/'donnees'
OUT=pathlib.Path(__file__).resolve().parent

def load(tf):
 d=pd.read_csv(DATA/(tf+'.csv'),sep='\t'); d.columns=[s.strip('<>').lower() for s in d.columns]
 d['datetime']=pd.to_datetime(d['date']+' '+d['time'],format='%Y.%m.%d %H:%M:%S') if 'time' in d else pd.to_datetime(d['date'],format='%Y.%m.%d')
 return d.set_index('datetime').sort_index()[['open','high','low','close']].astype('float32')

m15=load('m15');h1=load('h1');h4=load('h4');d1=load('d1');m30=load('m30')
print('loaded',len(m15),len(h1),len(h4),len(d1),flush=True)

# Each higher-TF candle only becomes observable at start of the NEXT same-TF candle.
# If it spans a missing session, do not use future bars until actually released.
def htf_asof(h,baseidx,prefix):
  ix=h.index
  # one bar closed only when a new native bar begins, no clairvoyance
  z=h.iloc[:-1].copy()
  z.index=ix[1:]
  z[prefix+'c']=h.close.iloc[:-1].values
  z[prefix+'mom3']=h.close.iloc[:-1].values - h.close.shift(3).iloc[:-1].values
  z[prefix+'mom6']=h.close.iloc[:-1].values - h.close.shift(6).iloc[:-1].values
  z[prefix+'range12']=((h.high.rolling(12).max()-h.low.rolling(12).min()).iloc[:-1]).values
  z[prefix+'mid12']=((h.high.rolling(12).max()+h.low.rolling(12).min())/2).iloc[:-1].values
  z[prefix+'up2']=((h.close>h.open)&(h.close.shift(1)>h.open.shift(1))).iloc[:-1].values
  z[prefix+'down2']=((h.close<h.open)&(h.close.shift(1)<h.open.shift(1))).iloc[:-1].values
  z=z[[prefix+'c',prefix+'mom3',prefix+'mom6',prefix+'range12',prefix+'mid12',prefix+'up2',prefix+'down2']]
  return z.reindex(baseidx,method='ffill')

b=m15.copy()
# completed last bar at next candle open
p=b.shift(1)
for n in [3,4,6,8,12,16]:
 b[f'priorhi{n}']=b.high.shift(2).rolling(n).max() # prior n completed, EXCLUDE latest trigger bar
 b[f'priorlo{n}']=b.low.shift(2).rolling(n).min()
 b[f'stoplo{n}']=b.low.shift(1).rolling(n).min()
 b[f'stophi{n}']=b.high.shift(1).rolling(n).max()
b['triggerclose']=p.close
b['triggeropen']=p.open
b['triggerhigh']=p.high
b['triggerlow']=p.low
b['lastbody']=(p.close-p.open).abs()
b['lastrange']=(p.high-p.low)
b['prevclose']=b.close.shift(2)
b['prevopen']=b.open.shift(2)
b['atr']=pd.concat([b.high-b.low,(b.high-b.close.shift()).abs(),(b.low-b.close.shift()).abs()],axis=1).max(axis=1).shift(1).rolling(14).mean()
for name,df in [('h1',h1),('h4',h4),('d1',d1),('m30',m30)]: b=b.join(htf_asof(df,b.index,name+'_'))
# Masks depending on trend, side; sign check on native completed HTF candles
hh=(b.h1_mom6>0)&(b.h4_mom3>0); ll=(b.h1_mom6<0)&(b.h4_mom3<0)
trend={
 'H1H4_mom':(hh,ll),
 'H4_D1_mom':((b.h4_mom3>0)&(b.d1_mom3>0),(b.h4_mom3<0)&(b.d1_mom3<0)),
 'H1H4D1':((b.h1_mom6>0)&(b.h4_mom3>0)&(b.d1_mom3>0),(b.h1_mom6<0)&(b.h4_mom3<0)&(b.d1_mom3<0)),
 'H1_M30':((b.h1_mom6>0)&(b.m30_mom3>0),(b.h1_mom6<0)&(b.m30_mom3<0))
}
# No future leak in trigger patterns; these are evaluated on last COMPLETED M15 candle.
entry={}
for n in [4,8,12]:
  entry[f'break{n}']=((b.triggerclose>b[f'priorhi{n}'])&(b.triggerclose>b.triggeropen),(b.triggerclose<b[f'priorlo{n}'])&(b.triggerclose<b.triggeropen))
# End-of-pullback M15 bullish/bearish engulfing with completed H1/H4 direction
entry['engulf']=((b.triggerclose>b.triggeropen)&(b.prevclose<b.prevopen)&(b.triggerclose>b.prevopen)&(b.triggeropen<b.prevclose), (b.triggerclose<b.triggeropen)&(b.prevclose>b.prevopen)&(b.triggerclose<b.prevopen)&(b.triggeropen>b.prevclose))
entry['strong_reversal']=((b.triggerclose>b.triggeropen)&(b.prevclose<b.prevopen)&(b.triggerclose>b.prevopen)&(b.lastbody>.5*b.lastrange), (b.triggerclose<b.triggeropen)&(b.prevclose>b.prevopen)&(b.triggerclose<b.prevopen)&(b.lastbody>.5*b.lastrange))

idx=b.index
A={c:b[c].to_numpy() for c in b.columns if b[c].dtype.kind in 'fbi'}
segments={2025:(np.datetime64('2025-01-01'),np.datetime64('2026-01-01')),2026:(np.datetime64('2026-01-01'),np.datetime64('2026-10-10'))}
# no trading on first M15 after significant gaps, with minimum 16-bars warmup
contiguous=np.r_[False,np.diff(idx.values).astype('timedelta64[m]').astype(int)==15]

def mk_candidates(e,t,stoptype,stopparam):
 elong,eshort=entry[e];long,short=trend[t]
 go_long=(elong&long&contiguous).fillna(False).to_numpy();go_short=(eshort&short&contiguous).fillna(False).to_numpy()
 go=np.where(go_long,1,np.where(go_short,-1,0)).astype('int8')
 if stoptype=='atr':
  dist=A['atr']*stopparam
  sl=A['open']-go*dist
 elif stoptype=='swing':
  sl=np.where(go==1,A[f'stoplo{stopparam}']-0.1,A[f'stophi{stopparam}']+0.1)
  dist=(A['open']-sl)*go
 else:raise ValueError
 # avoid stop on wrong side, allow stop if > 0.5 USD
 go=np.where((dist>=.6)&(dist<100)&np.isfinite(dist),go,0)
 return go,dist.astype('float32')

def simulate(year,go,dist,tpR=2.,expiry_bars=24,spread=.3,risk_percent=2.):
 st,en=segments[year];start=int(np.searchsorted(idx.values,st));end=int(np.searchsorted(idx.values,en))
 eq=1150.; peak=1150.;max_dd=0.; pnl_month={};trades=[];counts=dict(signal=0,invalid_sl=0,risk_minlot=0,margin_minlot=0,allowed=0,stops=0,targets=0,expires=0,ambiguous=0,overnight_gaps=0)
 # sequential M15 candles, no overlap, entry at OPEN of bar t triggered by previous closed M15
 i=start
 while i<end:
  side=int(go[i]);
  if side==0:i+=1;continue
  counts['signal']+=1
  entry_price=float(A['open'][i]); stopdist=float(dist[i]);fee1=(spread+.1)*100+6 # $ per 1 lot full cost (100oz)
  if stopdist*1 + fee1*.01 > .02*eq+1e-6: # 0.01 lot: 1oz exposure
   counts['risk_minlot']+=1;i+=1;continue
  lotmargin=entry_price*100*.01/20
  if lotmargin>eq:
   counts['margin_minlot']+=1;i+=1;continue
  raw=.02*eq/(100*stopdist+fee1)
  lot=round(np.floor((min(raw,eq*20/(entry_price*100))+1e-9)/.01)*.01,2)
  if lot<.01:counts['risk_minlot']+=1;i+=1;continue
  counts['allowed']+=1
  stop=entry_price-side*stopdist;target=entry_price+side*stopdist*tpR
  exit_price=entry_price;reason='END';endbar=i
  # On entry bar, same M15 OHLC is allowed to reach both endpoints. If both, count SL first.
  for j in range(i,min(end,i+expiry_bars)):
   o=float(A['open'][j]);h=float(A['high'][j]);l=float(A['low'][j]);c=float(A['close'][j]);
   if j>i and not contiguous[j]:
    # market gaps: first open is executable; honor stop or TP conservatively
    counts['overnight_gaps']+=1
   if side==1:
    stop_touch=l<=stop;target_touch=h>=target
    if o<=stop and j>i:exit_price=o;reason='SL_GAP'
    elif o>=target and j>i:exit_price=target;reason='TP_GAP'
    elif stop_touch:exit_price=stop;reason='SL'
    elif target_touch:exit_price=target;reason='TP'
    else:exit_price=c
   else:
    stop_touch=h>=stop;target_touch=l<=target
    if o>=stop and j>i:exit_price=o;reason='SL_GAP'
    elif o<=target and j>i:exit_price=target;reason='TP_GAP'
    elif stop_touch:exit_price=stop;reason='SL'
    elif target_touch:exit_price=target;reason='TP'
    else:exit_price=c
   if stop_touch and target_touch:counts['ambiguous']+=1
   endbar=j
   if reason!='END':break
  if reason=='END':reason='TIME'
  if reason.startswith('SL'):counts['stops']+=1
  elif reason.startswith('TP'):counts['targets']+=1
  else:counts['expires']+=1
  gain=(exit_price-entry_price)*side*lot*100-lot*fee1
  eq+=gain;peak=max(peak,eq);max_dd=max(max_dd,(peak-eq)/peak)
  trmonth=str(idx[endbar].to_period('M'))
  pnl_month[trmonth]=pnl_month.get(trmonth,0)+gain
  trades.append(dict(year=year,open_time=str(idx[i]),close_time=str(idx[endbar]),side=side,lot=lot,entry_price=entry_price,stop_price=stop,target_price=target,exit_price=exit_price,why=reason,pnl=gain,capital=eq,planned_pct=(stopdist*lot*100+fee1*lot)/(eq-gain)*100,fee=fee1*lot,month=trmonth))
  i=endbar+1
  # no more than one position simultaneously, no same-bar re-entry
 gains=[t['pnl'] for t in trades]
 pf=round(sum(g for g in gains if g>0)/(-sum(g for g in gains if g<0)),3) if any(g<0 for g in gains) else (None if not gains else 999)
 return dict(year=year,pnl=round(eq-1150,2),capital=round(eq,2),trades=len(trades),positive_months=sum(x>0 for x in pnl_month.values()),drawdown=round(max_dd*100,2),pf=pf,**counts),trades

if __name__=='__main__':
 results=[];best=[]
 # limited predeclared grid; no month specific treatment; test candidates on both years but prefer robust consistency.
 for (ename,tname,stopkind,stopn,tpR) in itertools.product(entry,trend,['atr','swing'],[1.0,1.5,2.0] , [1.5,2.0,3.0]):
  if stopkind=='swing' and stopn!=2.:continue
  go,dist=mk_candidates(ename,tname,stopkind,int(4) if stopkind=='swing' else float(stopn))
  for yr in (2025,2026):
   stat,_=simulate(yr,go,dist,tpR=tpR,expiry_bars=32)
   stat.update(entry_type=ename,trend_type=tname,stop_kind=stopkind,stop_value=4 if stopkind=='swing' else stopn,tpR=tpR)
   results.append(stat)
 df=pd.DataFrame(results);df.to_csv(OUT/'GRILLE_EXPLORATOIRE.csv',index=False)
 wide=df.pivot(index=['entry_type','trend_type','stop_kind','stop_value','tpR'],columns='year',values=['pnl','trades','drawdown','pf']);wide.columns=[f'{k}_{y}' for k,y in wide.columns];wide=wide.reset_index();wide['worst_year']=wide[['pnl_2025','pnl_2026']].min(axis=1);wide['sum_profit']=wide[['pnl_2025','pnl_2026']].sum(axis=1)
 wide.to_csv(OUT/'BILAN_CANDIDATS.csv',index=False)
 print('top worst-year');print(wide.sort_values(['worst_year','sum_profit'],ascending=False).head(20).to_string(index=False));print('top 2025');print(wide.sort_values('pnl_2025',ascending=False).head(10).to_string(index=False));print('top 2026');print(wide.sort_values('pnl_2026',ascending=False).head(10).to_string(index=False))
