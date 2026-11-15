"""PAPER only: M5-first-touch when exact and complete, else conservative M15-first-touch.
No bid/ask or real orders; input candles are native MT5 and releases of H4/D1 are delayed until next bar open.
"""
from recherche_m15 import *
x=load('m5')
segs={}
m5_idx=x.index
for i,t in enumerate(idx):
 k=m5_idx.searchsorted(t)
 if k+2<len(m5_idx) and m5_idx[k]==t and m5_idx[k+1]==t+pd.Timedelta(minutes=5) and m5_idx[k+2]==t+pd.Timedelta(minutes=10):
  z=x.iloc[k:k+3];r=b.iloc[i]
  if (abs(float(z.open.iloc[0])-float(r.open))<.03 and
      abs(float(z.close.iloc[-1])-float(r.close))<.03 and
      abs(float(z.high.max())-float(r.high))<.03 and
      abs(float(z.low.min())-float(r.low))<.03):
   segs[i]=(z.open.to_numpy(),z.high.to_numpy(),z.low.to_numpy(),z.close.to_numpy())
entry['break16']=((b.triggerclose>b.priorhi16)&(b.triggerclose>b.triggeropen),
                  (b.triggerclose<b.priorlo16)&(b.triggerclose<b.triggeropen))

def simulate_fine(year,go,dist,tpR=2.,expiry_bars=32,spread=.3,risk_percent=2.):
 st,en=segments[year];start=int(np.searchsorted(idx.values,st));end=int(np.searchsorted(idx.values,en))
 eq=1150.;peak=1150.;peak_intrabar=1150.;max_dd=0.;max_dd_float=0.;pnl_month={};trades=[]
 counts=dict(signal=0,risk_minlot=0,margin_minlot=0,allowed=0,stops=0,targets=0,expires=0,ambiguous_m5=0,ambiguous_m15_fallback=0,m5_used_candles=0,m15_fallback_candles=0,gaps=0)
 i=start
 while i<end:
  side=int(go[i])
  if side==0:i+=1;continue
  counts['signal']+=1
  entry_price=float(A['open'][i]);stopdist=float(dist[i]);fee1=(spread+.1)*100+6
  if stopdist+fee1*.01 > eq*risk_percent/100 + 1e-6:
   counts['risk_minlot']+=1;i+=1;continue
  if entry_price/20>eq:counts['margin_minlot']+=1;i+=1;continue
  raw=eq*risk_percent/100/(stopdist*100+fee1)
  lot=round(np.floor((min(raw,eq*20/(entry_price*100))+1e-9)/.01)*.01,2)
  if lot<.01:counts['risk_minlot']+=1;i+=1;continue
  counts['allowed']+=1
  stop=entry_price-side*stopdist;target=entry_price+side*stopdist*tpR
  exit_price=entry_price;reason='END';endbar=i
  for j in range(i,min(end,i+expiry_bars)):
   if j in segs:
    opens,his,los,closes=segs[j];counts['m5_used_candles']+=1
   else:
    opens=[float(A['open'][j])];his=[float(A['high'][j])];los=[float(A['low'][j])];closes=[float(A['close'][j])];counts['m15_fallback_candles']+=1
   if j>i and not contiguous[j]:counts['gaps']+=1
   for step,(o,h,l,c) in enumerate(zip(opens,his,los,closes)):
    o,h,l,c=float(o),float(h),float(l),float(c)
    if side==1:
      stop_touch=l<=stop;tp_touch=h>=target
      if (j>i or step>0) and o<=stop:exit_price=o;reason='SL_GAP'
      elif (j>i or step>0) and o>=target:exit_price=target;reason='TP_GAP'
      elif stop_touch:exit_price=stop;reason='SL'
      elif tp_touch:exit_price=target;reason='TP'
      else:exit_price=c
    else:
      stop_touch=h>=stop;tp_touch=l<=target
      if (j>i or step>0) and o>=stop:exit_price=o;reason='SL_GAP'
      elif (j>i or step>0) and o<=target:exit_price=target;reason='TP_GAP'
      elif stop_touch:exit_price=stop;reason='SL'
      elif tp_touch:exit_price=target;reason='TP'
      else:exit_price=c
    if stop_touch and tp_touch:
       if j in segs:counts['ambiguous_m5']+=1
       else:counts['ambiguous_m15_fallback']+=1
    mark=eq+(c-entry_price)*side*100*lot-lot*fee1
    peak_intrabar=max(peak_intrabar,mark)
    max_dd_float=max(max_dd_float,(peak_intrabar-mark)/peak_intrabar)
    if reason!='END':break
   endbar=j
   if reason!='END':break
  if reason=='END':reason='TIME'
  if reason.startswith('SL'):counts['stops']+=1
  elif reason.startswith('TP'):counts['targets']+=1
  else:counts['expires']+=1
  gain=(exit_price-entry_price)*side*lot*100-lot*fee1
  eq+=gain;peak=max(peak,eq);max_dd=max(max_dd,(peak-eq)/peak)
  trmonth=str(idx[endbar].to_period('M'));pnl_month[trmonth]=pnl_month.get(trmonth,0)+gain
  trades.append(dict(year=year,open_time=str(idx[i]),close_time=str(idx[endbar]),side=side,lot=lot,entry_price=entry_price,stop_price=stop,target_price=target,exit_price=exit_price,why=reason,pnl=gain,capital=eq,planned_pct=(stopdist*lot*100+fee1*lot)/(eq-gain)*100,fee=fee1*lot,month=trmonth))
  i=endbar+1
 gains=[t['pnl'] for t in trades]
 pf=round(sum(g for g in gains if g>0)/(-sum(g for g in gains if g<0)),3) if any(g<0 for g in gains) else None
 return dict(year=year,pnl=round(eq-1150,2),capital=round(eq,2),trades=len(trades),positive_months=sum(x>0 for x in pnl_month.values()),drawdown=round(max_dd*100,2),drawdown_intrabar=round(max_dd_float*100,2),pf=pf,**counts),trades

